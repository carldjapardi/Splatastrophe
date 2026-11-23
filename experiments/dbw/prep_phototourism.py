"""Turn an IMC-PT PhotoTourism scene (COLMAP dense model) into a DBW-ready dataset.

Output dir:
  images/<name>.jpg   center-cropped + resized to W x H
  cameras.npz         K (N,3,3) for the cropped images, R (N,3,3), t (N,3) world->cam (OpenCV),
                      names, plus the normalization (center c, rotation A, scale s):
                      x_dbw = s * A @ (x_colmap - c)
  points.npy          normalized sparse points near the landmark (pseudo GT for eval only)
  masks/<name>.png    (with --masks) 255 = landmark, 0 = background, 128 = ignored
  views.json          kept views and the reason each skipped view was dropped
  check_*.jpg         sparse points (red), ground grid (green) and mask (blue) on a few views

DBW frame: +y up, ground at y = --ground_y, landmark's long axis along x.

Crop modes:
  center  resize to cover W x H and center-crop (v1); landscape photos only
  gate    crop a W:H window around the projected landmark (sparse-point bbox plus --margin)

Typical v2 flow (gate crop with masks):
  1. prep ... --crop gate --stage_masks STAGE      # select views, stage them for the mask generator
  2. python -m pipeline.reconstruction.generate_landmark_masks STAGE MASKS --prompt ... --detail ...
  3. prep ... --crop gate --masks MASKS            # write images, masks and cameras
"""
import json
import argparse, struct, csv, os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw


def read_cameras_bin(p):
    cams = {}
    nparams = {0: 3, 1: 4, 2: 4, 3: 5, 4: 8, 5: 8}  # SIMPLE_PINHOLE, PINHOLE, SIMPLE_RADIAL, RADIAL, OPENCV, OPENCV_FISHEYE
    with open(p, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        for _ in range(n):
            cid, model, w, h = struct.unpack('<iiQQ', f.read(24))
            params = struct.unpack('<' + 'd' * nparams[model], f.read(8 * nparams[model]))
            if model in (0, 2, 3):
                fx = fy = params[0]; cx, cy = params[1], params[2]
            else:
                fx, fy, cx, cy = params[:4]
            cams[cid] = dict(w=w, h=h, fx=fx, fy=fy, cx=cx, cy=cy, model=model)
    return cams


def qvec2rot(q):
    w, x, y, z = q
    return np.array([[1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y],
                     [2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x],
                     [2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y]])


def read_images_bin(p):
    imgs = {}
    with open(p, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        for _ in range(n):
            iid = struct.unpack('<i', f.read(4))[0]
            q = struct.unpack('<4d', f.read(32)); t = struct.unpack('<3d', f.read(24))
            cid = struct.unpack('<i', f.read(4))[0]
            name = b''
            while True:
                c = f.read(1)
                if c == b'\x00':
                    break
                name += c
            npts = struct.unpack('<Q', f.read(8))[0]
            f.seek(24 * npts, 1)
            imgs[name.decode()] = dict(R=qvec2rot(q), t=np.array(t), cam=cid)
    return imgs


def read_points_bin(p):
    xyz, track = [], []
    with open(p, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        for _ in range(n):
            data = f.read(43)
            x = struct.unpack('<3d', data[8:32])
            tl = struct.unpack('<Q', f.read(8))[0]
            f.seek(8 * tl, 1)
            xyz.append(x); track.append(tl)
    return np.array(xyz), np.array(track)


def gate_window(bbox, w, h, W, H, margin):
    """Smallest W:H window holding bbox plus margin, shifted inside the w x h photo. None if it can't fit."""
    x0, y0, x1, y1 = bbox
    bw, bh = (x1 - x0) * (1 + 2 * margin), (y1 - y0) * (1 + 2 * margin)
    ww = max(bw, bh * W / H)
    wh = ww * H / W
    if ww > w or wh > h:
        return None
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left = min(max(cx - ww / 2, 0), w - ww)
    top = min(max(cy - wh / 2, 0), h - wh)
    win = (int(round(left)), int(round(top)), int(round(ww)), int(round(wh)))
    if win[0] + win[2] > w or win[1] + win[3] > h:
        win = (min(win[0], w - win[2]), min(win[1], h - win[3]), win[2], win[3])
    return win


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scene', required=True, help='.../brandenburg_gate/dense')
    ap.add_argument('--tsv', required=True)
    ap.add_argument('--out', help='DBW dataset dir to write')
    ap.add_argument('--W', type=int, default=384)
    ap.add_argument('--H', type=int, default=288)
    ap.add_argument('--height', type=float, default=1.4, help='landmark height in DBW units')
    ap.add_argument('--ground_y', type=float, default=-0.9, help='ground height in DBW units')
    ap.add_argument('--max_cam_dist', type=float, default=8.0)
    ap.add_argument('--crop', choices=['center', 'gate'], default='center')
    ap.add_argument('--margin', type=float, default=0.15, help='gate crop: margin around the landmark bbox')
    ap.add_argument('--min_gate_px', type=int, default=200, help='gate crop: min landmark bbox height in the photo')
    ap.add_argument('--stage_masks', help='write a staging dir for generate_landmark_masks and stop')
    ap.add_argument('--masks', help='dir of full-resolution <stem>.png masks from generate_landmark_masks')
    ap.add_argument('--min_recall', type=float, default=0.6, help='min share of landmark points inside the mask')
    ap.add_argument('--ignore_band', type=float, default=0.15,
                    help='non-mask pixels in this lower share of the landmark bbox are ignored (crowds)')
    a = ap.parse_args()
    if not a.stage_masks and not a.out:
        ap.error('give --out or --stage_masks')
    scene = Path(a.scene)

    cams = read_cameras_bin(scene / 'sparse' / 'cameras.bin')
    imgs = read_images_bin(scene / 'sparse' / 'images.bin')
    xyz, track = read_points_bin(scene / 'sparse' / 'points3D.bin')
    with open(a.tsv) as f:
        rows = [r for r in csv.DictReader(f, delimiter='\t')]
    train = [r['filename'] for r in rows if r['split'] == 'train' and r['filename'] in imgs]
    print(f'{len(imgs)} registered images, {len(train)} in the NeRF-W train split, {len(xyz)} points')

    # Up = mean camera up (photos are mostly upright). OpenCV cam y points down.
    ups = np.stack([-imgs[n]['R'].T @ np.array([0, 1, 0]) for n in train])
    up = ups.mean(0); up /= np.linalg.norm(up)

    pts = xyz[track >= 5]
    c0 = np.median(pts, 0)
    d = pts - c0
    horiz = d - np.outer(d @ up, up)
    r = np.linalg.norm(horiz, axis=1)
    core = pts[r < np.percentile(r, 60)]
    dc = core - np.median(core, 0)
    hc = dc - np.outer(dc @ up, up)
    _, _, vt = np.linalg.svd(hc, full_matrices=False)
    xa = vt[0] - (vt[0] @ up) * up; xa /= np.linalg.norm(xa)
    za = np.cross(xa, up)
    A = np.stack([xa, up, za])  # rows: new x, y, z

    loc = (core - np.median(core, 0)) @ A.T
    y_lo, y_hi = np.percentile(loc[:, 1], [2, 98])
    s = a.height / (y_hi - y_lo)
    c = np.median(core, 0) + A.T @ np.array([0, y_lo - a.ground_y / s, 0])
    norm = lambda p: s * (p - c) @ A.T
    core_n = norm(core)
    lo, hi = np.percentile(core_n, [2, 98], axis=0)
    print('core extent (DBW units) x/y/z:', np.stack([lo, hi]).round(2).tolist())
    inner = core_n[((core_n >= lo) & (core_n <= hi)).all(1)]

    views, skipped = [], {}
    for n in train:
        im, cam = imgs[n], cams[imgs[n]['cam']]
        Rn = im['R'] @ A.T
        tn = s * (im['R'] @ c + im['t'])
        w, h = cam['w'], cam['h']
        K0 = np.array([[cam['fx'], 0, cam['cx']], [0, cam['fy'], cam['cy']], [0, 0, 1]])
        if np.linalg.norm(-Rn.T @ tn) > a.max_cam_dist:
            skipped[n] = 'camera too far'; continue
        pc = inner @ Rn.T + tn
        if (pc[:, 2] <= 0.05).mean() > 0.01:
            skipped[n] = 'landmark behind camera'; continue
        uv = (pc @ K0.T)[:, :2] / pc[:, 2:3]
        bx0, by0 = np.percentile(uv, 3, axis=0)
        bx1, by1 = np.percentile(uv, 97, axis=0)
        if a.crop == 'center':
            if w < h:
                skipped[n] = 'portrait'; continue
            sc = max(a.W / w, a.H / h)
            win = (int(round((w * sc - a.W) / 2 / sc)), int(round((h * sc - a.H) / 2 / sc)),
                   int(round(a.W / sc)), int(round(a.H / sc)))
            u, v = (K0 @ (Rn @ np.array([0, a.ground_y + a.height * 0.5, 0]) + tn))[:2] / \
                (Rn @ np.array([0, a.ground_y + a.height * 0.5, 0]) + tn)[2]
            if not (win[0] <= u < win[0] + win[2] and win[1] <= v < win[1] + win[3]):
                skipped[n] = 'landmark center outside crop'; continue
        else:
            if by1 - by0 < a.min_gate_px:
                skipped[n] = 'landmark too small'; continue
            if bx0 < 0 or by0 < 0 or bx1 > w or by1 > h:
                skipped[n] = 'landmark cut off by photo edge'; continue
            win = gate_window((bx0, by0, bx1, by1), w, h, a.W, a.H, a.margin)
            if win is None:
                skipped[n] = 'crop does not fit photo'; continue
        views.append(dict(name=n, R=Rn, t=tn, K0=K0, w=w, h=h, win=win, bbox=(bx0, by0, bx1, by1), uv=uv))
    print(f'{len(views)} views pass the geometric checks; skipped: '
          + ', '.join(f'{k} {v}' for k, v in sorted(_count(skipped).items())))

    if a.stage_masks:
        stage = Path(a.stage_masks)
        stage.mkdir(parents=True, exist_ok=True)
        if not (stage / 'images').exists():
            (stage / 'images').symlink_to((scene / 'images').resolve())
        (stage / 'transforms.json').write_text(json.dumps(
            {'train_filenames': [f'images/{v["name"]}' for v in views]}, indent=1))
        print(f'staged {len(views)} views in {stage} for generate_landmark_masks')
        return

    out = Path(a.out)
    (out / 'images').mkdir(parents=True, exist_ok=True)
    if a.masks:
        (out / 'masks').mkdir(exist_ok=True)
    Ks, Rs, ts, names, mask_stats = [], [], [], [], {}
    for v in views:
        n, (x0, y0, ww, wh) = v['name'], v['win']
        if a.masks:
            mp = Path(a.masks) / f'{Path(n).stem}.png'
            if not mp.exists():
                skipped[n] = 'no mask (generator rejected it)'; continue
            m = np.array(Image.open(mp).convert('L')) > 127
            if m.shape != (v['h'], v['w']):
                skipped[n] = 'mask size mismatch'; continue
            # The sparse "core" points cover only the central part of the landmark, so they check the mask
            # (recall) but the crop and ignore band use the mask's own bbox.
            ui = np.clip(v['uv'].round().astype(int), 0, [v['w'] - 1, v['h'] - 1])
            recall = m[ui[:, 1], ui[:, 0]].mean()
            ys, xs = np.nonzero(m)
            bx0, bx1 = np.percentile(xs, [0.2, 99.8])
            by0, by1 = np.percentile(ys, [0.2, 99.8])
            edge = 0.01 * max(v['w'], v['h'])
            cut = bx0 < edge or by0 < edge or bx1 > v['w'] - edge or by1 > v['h'] - edge
            mask_stats[n] = dict(recall=round(float(recall), 3), bbox=[int(bx0), int(by0), int(bx1), int(by1)])
            if recall < a.min_recall:
                skipped[n] = 'mask misses landmark points'; continue
            if cut:
                skipped[n] = 'mask touches photo edge'; continue
            if a.crop == 'gate':
                win = gate_window((bx0, by0, bx1, by1), v['w'], v['h'], a.W, a.H, a.margin)
                if win is None:
                    skipped[n] = 'crop does not fit photo'; continue
                x0, y0, ww, wh = win
            pw, ph = (bx1 - bx0) * 0.1, (by1 - by0) * 0.1
            tri = np.where(m, 255, 0).astype(np.uint8)
            band = np.zeros_like(m)
            band[int(by1 - a.ignore_band * (by1 - by0)):int(by1 + ph), max(int(bx0 - pw), 0):int(bx1 + pw)] = True
            tri[band & ~m] = 128
            Image.fromarray(tri).crop((x0, y0, x0 + ww, y0 + wh)).resize((a.W, a.H), Image.NEAREST) \
                .save(out / 'masks' / f'{Path(n).stem}.png')
        sx, sy = a.W / ww, a.H / wh
        img = Image.open(scene / 'images' / n).convert('RGB')
        img.crop((x0, y0, x0 + ww, y0 + wh)).resize((a.W, a.H), Image.BICUBIC).save(out / 'images' / n, quality=95)
        K0 = v['K0']
        K = np.array([[K0[0, 0] * sx, 0, (K0[0, 2] - x0) * sx], [0, K0[1, 1] * sy, (K0[1, 2] - y0) * sy], [0, 0, 1]])
        Ks.append(K); Rs.append(v['R']); ts.append(v['t']); names.append(n)

    (out / 'views.json').write_text(json.dumps(
        {'args': vars(a), 'kept': names, 'skipped': skipped, 'mask_stats': mask_stats}, indent=1))
    if not names:
        raise SystemExit('no views kept; see views.json for the reasons')
    Ks, Rs, ts = map(np.array, (Ks, Rs, ts))
    print(f'kept {len(names)} views; camera distance from origin median '
          f'{np.median(np.linalg.norm(np.einsum("nji,nj->ni", Rs, -ts), axis=1)):.2f}')
    print('skipped: ' + ', '.join(f'{k} {v}' for k, v in sorted(_count(skipped).items())))
    np.savez(out / 'cameras.npz', K=Ks, R=Rs, t=ts, names=np.array(names), c=c, A=A, s=s, W=a.W, H=a.H,
             ground_y=a.ground_y)
    np.save(out / 'points.npy', core_n.astype(np.float32))

    for i in np.linspace(0, len(names) - 1, 6).astype(int):
        img = Image.open(out / 'images' / names[i]).convert('RGB')
        mp = out / 'masks' / f'{Path(names[i]).stem}.png'
        if mp.exists():
            m = np.array(Image.open(mp))
            tint = np.array(img).astype(float)
            tint[m == 255] = tint[m == 255] * 0.5 + np.array([0, 0, 255]) * 0.5
            tint[m == 128] = tint[m == 128] * 0.5 + np.array([255, 255, 0]) * 0.5
            img = Image.fromarray(tint.astype(np.uint8))
        dr = ImageDraw.Draw(img)
        pcam = core_n @ Rs[i].T + ts[i]
        pcam = pcam[pcam[:, 2] > 0]
        uv = (pcam @ Ks[i].T)[:, :2] / pcam[:, 2:3]
        for u, v in uv[::5]:
            dr.point((u, v), fill=(255, 0, 0))
        for g in np.linspace(-3, 3, 13):
            for line in ([[g, a.ground_y, -3], [g, a.ground_y, 3]], [[-3, a.ground_y, g], [3, a.ground_y, g]]):
                P = np.array(line) @ Rs[i].T + ts[i]
                if (P[:, 2] > 0.05).all():
                    q = (P @ Ks[i].T)[:, :2] / P[:, 2:3]
                    dr.line([tuple(q[0]), tuple(q[1])], fill=(0, 255, 0))
        img.save(out / f'check_{i}.jpg')


def _count(skipped):
    out = {}
    for reason in skipped.values():
        out[reason] = out.get(reason, 0) + 1
    return out


if __name__ == '__main__':
    main()

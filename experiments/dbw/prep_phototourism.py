"""Turn an IMC-PT PhotoTourism scene (COLMAP dense model) into a DBW-ready dataset.

Output dir:
  images/<name>.jpg   center-cropped + resized to W x H
  cameras.npz         K (N,3,3) for the cropped images, R (N,3,3), t (N,3) world->cam (OpenCV),
                      names, plus the normalization (center c, rotation A, scale s):
                      x_dbw = s * A @ (x_colmap - c)
  points.npy          normalized sparse points near the landmark (pseudo GT for eval only)
  check_*.jpg         sparse points projected onto a few views (sanity check)

DBW frame: +y up, ground near y = -0.9, landmark's long axis along x.
"""
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scene', required=True, help='.../brandenburg_gate/dense')
    ap.add_argument('--tsv', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--W', type=int, default=384)
    ap.add_argument('--H', type=int, default=288)
    ap.add_argument('--height', type=float, default=1.4, help='landmark height in DBW units')
    ap.add_argument('--max_cam_dist', type=float, default=8.0)
    a = ap.parse_args()
    scene, out = Path(a.scene), Path(a.out)
    (out / 'images').mkdir(parents=True, exist_ok=True)

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
    c = np.median(core, 0) + A.T @ np.array([0, y_lo + 0.9 / s, 0])
    norm = lambda p: s * (p - c) @ A.T
    core_n = norm(core)
    print('core extent (DBW units) x/y/z:', np.percentile(core_n, [2, 98], axis=0).round(2).tolist())

    Ks, Rs, ts, names = [], [], [], []
    for n in train:
        im, cam = imgs[n], cams[imgs[n]['cam']]
        Rn = im['R'] @ A.T
        tn = s * (im['R'] @ c + im['t'])
        center = -Rn.T @ tn
        if np.linalg.norm(center) > a.max_cam_dist:
            continue
        w, h = cam['w'], cam['h']
        if w < h:  # skip portrait shots; center-cropping them to 4:3 landscape loses most of the frame
            continue
        sc = max(a.W / w, a.H / h)
        ox, oy = (w * sc - a.W) / 2, (h * sc - a.H) / 2
        K = np.array([[cam['fx'] * sc, 0, cam['cx'] * sc - ox], [0, cam['fy'] * sc, cam['cy'] * sc - oy], [0, 0, 1]])
        # require the landmark center (0, -0.2, 0) in front and inside the crop
        pc = Rn @ np.array([0, -0.2, 0]) + tn
        if pc[2] <= 0:
            continue
        u, v = (K @ pc)[:2] / pc[2]
        if not (0 <= u < a.W and 0 <= v < a.H):
            continue
        img = Image.open(scene / 'images' / n).convert('RGB')
        img = img.resize((round(w * sc), round(h * sc)), Image.BICUBIC)
        img = img.crop((round(ox), round(oy), round(ox) + a.W, round(oy) + a.H))
        img.save(out / 'images' / n, quality=95)
        Ks.append(K); Rs.append(Rn); ts.append(tn); names.append(n)

    Ks, Rs, ts = map(np.array, (Ks, Rs, ts))
    print(f'kept {len(names)} views; camera distance from origin median '
          f'{np.median(np.linalg.norm(np.einsum("nji,nj->ni", Rs, -ts), axis=1)):.2f}')
    np.savez(out / 'cameras.npz', K=Ks, R=Rs, t=ts, names=np.array(names), c=c, A=A, s=s, W=a.W, H=a.H)
    np.save(out / 'points.npy', core_n.astype(np.float32))

    for i in np.linspace(0, len(names) - 1, 4).astype(int):
        img = Image.open(out / 'images' / names[i]).convert('RGB')
        dr = ImageDraw.Draw(img)
        pcam = core_n @ Rs[i].T + ts[i]
        pcam = pcam[pcam[:, 2] > 0]
        uv = (pcam @ Ks[i].T)[:, :2] / pcam[:, 2:3]
        for u, v in uv[::5]:
            dr.point((u, v), fill=(255, 0, 0))
        # ground plane grid at y = -0.9
        for g in np.linspace(-3, 3, 13):
            for line in ([[g, -0.9, -3], [g, -0.9, 3]], [[-3, -0.9, g], [3, -0.9, g]]):
                P = np.array(line) @ Rs[i].T + ts[i]
                if (P[:, 2] > 0.05).all():
                    q = (P @ Ks[i].T)[:, :2] / P[:, 2:3]
                    dr.line([tuple(q[0]), tuple(q[1])], fill=(0, 255, 0))
        img.save(out / f'check_{i}.jpg')


if __name__ == '__main__':
    main()

"""Render the fault-point collapse building (web/public/faults/collapse.js) as a synthetic DBW dataset.

A control for the Brandenburg Gate runs: exact cameras, one fixed light, no crowds, and known parts. The block list is
copied from collapse.js (centre x, y, z and size dx, dy, dz in authored units, z up), so DBW's blocks can be scored
against true parts.

Output matches prep_phototourism.py, so the same DBW loader (phototourism.py) reads it:
  images/*.jpg, masks/*.png (255 building, 0 background), cameras.npz (K, R, t in OpenCV world-to-camera form, H, W,
  names), points.npy (surface samples), parts.json (true blocks in the DBW frame), check_*.jpg overlays.

Usage (needs torch + pytorch3d, e.g. outputs/dbw/venv-dbw):
  python synthetic_faults.py --out <dbw-repo>/datasets/phototourism/synthetic_faults --views 200
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw
from pytorch3d.renderer import (DirectionalLights, HardFlatShader, MeshRasterizer, MeshRenderer, RasterizationSettings,
                                TexturesVertex, BlendParams)
from pytorch3d.structures import Meshes, join_meshes_as_scene
from pytorch3d.utils import cameras_from_opencv_projection

H, W = 288, 384


def authored_blocks():
    """Same calls and order as collapse.js. Returns (fault, part, centre xyz, size xyz), z up."""
    blocks = []

    def add(fault, part, x, y, z, dx, dy, dz):
        blocks.append((fault, part, (x, y, z), (dx, dy, dz)))

    add(None, 'base', 0, 0, .18, 7.28, 2.80, .36)
    add(None, 'base', 0, 0, .43, 6.95, 2.53, .14)
    for row in range(5):
        z = .78 + row * .54
        stagger = .045 if row % 2 else -.045
        add('A', 'left wall', -2.68 + stagger, -.03, z, .80, 1.74, .51)
        add('A', 'left wall', -1.83 + stagger, -.03, z, .87, 1.74, .51)
        add('C', 'right wall', 1.82 + stagger, .09, z, .87, 1.72, .51)
        add('C', 'right wall', 2.68 + stagger, .09, z, .80, 1.72, .51)
        if row < 4:
            add('B', 'centre pier', -.49, -.71, z, .90, .30, .51)
            add('B', 'centre pier', .49, -.71, z, .90, .30, .51)
    for index in range(-3, 4):
        fault = 'A' if index < -1 else 'C' if index > 1 else 'B'
        add(fault, 'lintel', index * .88, 0, 3.31, .85, 1.85, .51)
        add(fault, 'attic', index * .88, 0, 3.75, .87, 2.04, .34)
    for index in range(-2, 3):
        add('B', 'cornice', index * .80, 0, 4.05, .77, 1.65, .25)
    add('B', 'top', -.71, 0, 4.33, .80, 1.34, .28)
    add('B', 'top', .15, 0, 4.33, .86, 1.34, .28)
    add('B', 'top', .67, 0, 4.61, .57, .87, .25)
    return blocks


def to_dbw(blocks):
    """Authored (x, y, z up) -> DBW frame (x, y up, z = -authored y), scaled to 1.4 units tall, ground at y = -0.9."""
    top = max(c[2] + s[2] / 2 for _, _, c, s in blocks)
    scale = 1.4 / top
    out = []
    for fault, part, (x, y, z), (dx, dy, dz) in blocks:
        centre = np.array([x, z, -y]) * scale + np.array([0, -0.9, 0])
        size = np.array([dx, dz, dy]) * scale
        out.append({'fault': fault, 'part': part, 'centre': centre.tolist(), 'size': size.tolist()})
    return out, scale


def box_mesh(centre, size, rgb):
    """Closed box with unshared vertices per face (flat shading)."""
    c, h = np.array(centre), np.array(size) / 2
    signs = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)])
    corners = c + signs * h
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    verts, faces = [], []
    for q in quads:
        base = len(verts)
        verts += [corners[i] for i in q]
        faces += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    v = torch.tensor(np.array(verts), dtype=torch.float32)
    f = torch.tensor(faces)
    # orient faces outward
    fc = v[f].mean(1)
    n = torch.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]], dim=1)
    flip = ((fc - torch.tensor(c, dtype=torch.float32)) * n).sum(1) < 0
    f[flip] = f[flip][:, [0, 2, 1]]
    return v, f, torch.tensor(rgb, dtype=torch.float32).expand(len(v), 3)


def ground_mesh(y=-0.9, half=3.0, tiles=24):
    verts, faces, cols = [], [], []
    step = 2 * half / tiles
    for i in range(tiles):
        for j in range(tiles):
            x0, z0 = -half + i * step, -half + j * step
            base = len(verts)
            verts += [[x0, y, z0], [x0 + step, y, z0], [x0 + step, y, z0 + step], [x0, y, z0 + step]]
            faces += [(base, base + 2, base + 1), (base, base + 3, base + 2)]
            tone = 0.42 if (i + j) % 2 else 0.47
            cols += [[tone, tone + 0.03, tone]] * 4
    return torch.tensor(verts, dtype=torch.float32), torch.tensor(faces), torch.tensor(cols, dtype=torch.float32)


def build_scene(parts):
    meshes = []
    for k, p in enumerate(parts):
        tone = 0.72 + 0.08 * ((np.sin((k + 1) * 25.26) + 1) / 2)  # stable per-block variation, as in collapse.js
        v, f, c = box_mesh(p['centre'], p['size'], [tone, tone * 0.97, tone * 0.9])
        meshes.append(Meshes([v], [f], TexturesVertex([c])))
    building = join_meshes_as_scene(meshes)
    v, f, c = ground_mesh()
    ground = Meshes([v], [f], TexturesVertex([c]))
    return building, join_meshes_as_scene([building, ground])


def sample_cameras(n, rng):
    """Orbit around the building: full 360 deg azimuth, 3-30 deg elevation, varied distance and focal length."""
    target = np.array([0, -0.25, 0])
    cams = []
    for i in range(n):
        azim = 2 * np.pi * (i / n) + rng.uniform(-0.05, 0.05)
        elev = np.deg2rad(rng.uniform(3, 30))
        dist = rng.uniform(2.6, 4.0)
        eye = target + dist * np.array([np.sin(azim) * np.cos(elev), np.sin(elev), np.cos(azim) * np.cos(elev)])
        eye[1] = max(eye[1], -0.8)
        fwd = target + rng.normal(0, 0.05, 3) - eye
        fwd /= np.linalg.norm(fwd)
        right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
        down = np.cross(fwd, right)
        R = np.stack([right, down, fwd])          # OpenCV: x right, y down, z forward
        t = -R @ eye
        f = rng.uniform(0.9, 1.6) * W * dist / 4.0  # keeps the building a similar size; focal length varies ~2x
        K = np.array([[f, 0, W / 2 + rng.uniform(-20, 20)], [0, f, H / 2 + rng.uniform(-15, 15)], [0, 0, 1]])
        cams.append((K, R, t))
    return cams


def sky(h, w):
    g = np.linspace(0, 1, h)[:, None, None]
    top, bottom = np.array([0.55, 0.68, 0.85]), np.array([0.85, 0.88, 0.9])
    return np.broadcast_to(top * (1 - g) + bottom * g, (h, w, 3))


def surface_points(parts, n=20000, rng=None):
    areas = []
    for p in parts:
        sx, sy, sz = p['size']
        areas.append(2 * (sx * sy + sy * sz + sx * sz))
    areas = np.array(areas) / sum(areas)
    pts = []
    for k in rng.choice(len(parts), n, p=areas):
        c, s = np.array(parts[k]['centre']), np.array(parts[k]['size'])
        u = rng.uniform(-0.5, 0.5, 3)
        axis = rng.integers(3)
        u[axis] = rng.choice([-0.5, 0.5])
        pts.append(c + u * s)
    return np.array(pts, dtype=np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--views', type=int, default=200)
    ap.add_argument('--seed', type=int, default=0)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    out = Path(args.out)
    for d in ('images', 'masks'):
        (out / d).mkdir(parents=True, exist_ok=True)

    parts, scale = to_dbw(authored_blocks())
    building, scene = build_scene(parts)
    cams = sample_cameras(args.views, rng)
    Ks = torch.tensor(np.array([c[0] for c in cams]), dtype=torch.float32)
    Rs = torch.tensor(np.array([c[1] for c in cams]), dtype=torch.float32)
    ts = torch.tensor(np.array([c[2] for c in cams]), dtype=torch.float32)
    size = torch.tensor([[H, W]]).expand(len(cams), 2)
    p3d_cams = cameras_from_opencv_projection(Rs, ts, Ks, size)

    light_dir = np.array([-0.42, -1.0, 0.28])  # synthetic-tower.json light, with z flipped into this frame
    lights = DirectionalLights(direction=[(-light_dir / np.linalg.norm(light_dir)).tolist()],
                               ambient_color=[[0.55, 0.55, 0.55]], diffuse_color=[[0.5, 0.5, 0.5]],
                               specular_color=[[0, 0, 0]])
    raster = RasterizationSettings(image_size=(H, W), faces_per_pixel=1, blur_radius=0.0)
    names = []
    bg = sky(H, W)
    for i in range(len(cams)):
        cam = p3d_cams[i]
        renderer = MeshRenderer(MeshRasterizer(cam, raster),
                                HardFlatShader(cameras=cam, lights=lights, blend_params=BlendParams(background_color=(0, 0, 0))))
        with torch.no_grad():
            rgba = renderer(scene)[0].numpy()
            frag = MeshRasterizer(cam, raster)(building)
        cover = rgba[..., 3:4] > 0
        img = np.where(cover, rgba[..., :3], bg).clip(0, 1)
        mask = (frag.pix_to_face[0, ..., 0] >= 0).numpy()
        name = f'{i:04d}.jpg'
        Image.fromarray((img * 255).astype(np.uint8)).save(out / 'images' / name, quality=92)
        Image.fromarray(mask.astype(np.uint8) * 255).save(out / 'masks' / f'{i:04d}.png')
        names.append(name)

    pts = surface_points(parts, rng=rng)
    np.save(out / 'points.npy', pts)
    np.savez(out / 'cameras.npz', K=Ks.double().numpy(), R=Rs.double().numpy(), t=ts.double().numpy(), H=H, W=W, names=np.array(names),
             c=np.zeros(3), A=np.eye(3), s=1.0)
    json.dump({'source': 'web/public/faults/collapse.js (authored blocks)', 'authored_to_dbw_scale': scale,
               'frame': 'DBW: x right, y up, ground at y = -0.9; authored y -> -z', 'blocks': parts},
              open(out / 'parts.json', 'w'), indent=1)
    json.dump({'views': len(names), 'kept': names, 'dropped': {}}, open(out / 'views.json', 'w'), indent=1)

    # check overlays: projected surface points (red) on image, mask tinted blue
    for i in rng.choice(len(names), 6, replace=False):
        im = Image.open(out / 'images' / names[i]).convert('RGB')
        m = np.array(Image.open(out / 'masks' / f'{int(i):04d}.png')) > 127
        a = np.array(im).astype(np.float32)
        a[m] = a[m] * 0.6 + np.array([60, 120, 255]) * 0.4
        im = Image.fromarray(a.astype(np.uint8))
        P = Ks[i].numpy() @ np.concatenate([Rs[i].numpy(), ts[i].numpy()[:, None]], 1)
        X = np.concatenate([pts[::25], np.ones((len(pts[::25]), 1))], 1) @ P.T
        xy = X[:, :2] / X[:, 2:]
        d = ImageDraw.Draw(im)
        for x, y in xy:
            d.point((float(x), float(y)), fill=(255, 40, 40))
        im.save(out / f'check_{int(i)}.jpg', quality=88)
    print(f'{len(names)} views -> {out}; {len(parts)} blocks; scale {scale:.4f}')


if __name__ == '__main__':
    main()

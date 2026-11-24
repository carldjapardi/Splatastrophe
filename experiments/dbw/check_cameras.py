"""Compare DBW camera projections: each view's own K vs the single K DBW keeps from the first batch.

Usage: python check_cameras.py <dbw-repo> <dataset-dir> <out.jpg>
Green = per-view K, red = shared K. Prints the share of sparse gate points inside each view's gate mask.
"""
import sys, numpy as np, torch
from PIL import Image, ImageDraw
from pathlib import Path
sys.path.insert(0, sys.argv[1] + '/src')
from dataset.bmvs import pytorch3d_KRT_from_proj
from pytorch3d.renderer import PerspectiveCameras
D = Path(sys.argv[2]); out = sys.argv[3]
c = np.load(D / 'cameras.npz'); H, W = int(c['H']), int(c['W']); names = [str(n) for n in c['names']]
pts = torch.from_numpy(np.load(D / 'points.npy')).float()
N = len(names)
KRT = [pytorch3d_KRT_from_proj(c['K'][i] @ np.concatenate([c['R'][i], c['t'][i][:, None]], 1), image_size=(H, W)) for i in range(N)]
def proj(Kp, R, T):
    cam = PerspectiveCameras(K=Kp[None].float(), R=R[None].float(), T=T[None].float(), in_ndc=True, image_size=((H, W),))
    s = cam.transform_points_screen(pts[None], image_size=((H, W),))[0]
    return s[:, :2].numpy()
def inmask(xy, m):
    x, y = np.round(xy[:, 0]).astype(int), np.round(xy[:, 1]).astype(int)
    ok = (x >= 0) & (x < W) & (y >= 0) & (y < H)
    hit = np.zeros(len(xy), bool); hit[ok] = m[y[ok], x[ok]] > 200
    return ok.mean(), hit.mean()
rng = np.random.default_rng(0)
ref = int(rng.integers(N))  # stands in for "first view of the first shuffled batch"
rows = []
for i in range(N):
    m = np.array(Image.open(D / 'masks' / f'{Path(names[i]).stem}.png'))
    K, R, T = KRT[i]
    a = inmask(proj(K, R, T), m); b = inmask(proj(KRT[ref][0], R, T), m)
    rows.append((*a, *b))
r = np.array(rows)
print(f'ref view {ref}, fx={c["K"][ref][0,0]:.0f}')
print('per-view K : in-frame %.2f  in-mask %.2f (median over views)' % tuple(np.median(r[:, :2], 0)))
print('shared K   : in-frame %.2f  in-mask %.2f (median over views)' % tuple(np.median(r[:, 2:], 0)))
print('views with in-mask < 0.5: per-view %d, shared %d of %d' % ((r[:, 1] < .5).sum(), (r[:, 3] < .5).sum(), N))
# figure
sel = list(np.argsort(r[:, 3])[[5, 30, 60]]) + list(np.argsort(r[:, 3])[[120, 180, 250]])
tiles = []
for i in sel:
    im = Image.open(D / 'images' / names[i]).convert('RGB'); dr = ImageDraw.Draw(im)
    K, R, T = KRT[i]
    for xy, col in [(proj(KRT[ref][0], R, T), (255, 60, 60)), (proj(K, R, T), (60, 255, 60))]:
        for x, y in xy[::12]:
            dr.ellipse((float(x)-1.5, float(y)-1.5, float(x)+1.5, float(y)+1.5), fill=col)
    tiles.append(im)
fig = Image.new('RGB', (W * 3, H * 2))
for k, t in enumerate(tiles): fig.paste(t, ((k % 3) * W, (k // 3) * H))
fig.save(out, quality=85)

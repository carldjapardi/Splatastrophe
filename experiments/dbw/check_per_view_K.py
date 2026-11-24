"""Unit check: does DBW's renderer place geometry correctly for every view in a batch with mixed intrinsics?
Renders small cubes at sparse gate points through model.renderer for a batch of views, with and without per-call K,
and measures how many per-view projected points (PyTorch3D PerspectiveCameras with that view's own K) fall on
rendered coverage.

Run from the DBW repo root after both patches: python <splatastrophe>/experiments/dbw/check_per_view_K.py"""
import sys, numpy as np, torch
sys.path.insert(0, 'src')
from utils import load_yaml
from utils.path import CONFIGS_PATH
from model import create_model
from dataset.phototourism import PhototourismDataset
from pytorch3d.structures import Meshes
from pytorch3d.renderer import TexturesVertex, PerspectiveCameras
torch.manual_seed(0)
cfg = load_yaml(CONFIGS_PATH / 'phototourism/brandenburg_v2.yml')
ds = PhototourismDataset('train', tag='brandenburg_v2', on_disk=False)
H, W = ds.img_size
model = create_model(cfg, ds.img_size).eval()
fx = np.array([float(k[0][0, 0]) for k in ds.KRT])
order = np.argsort(fx)
views = [int(order[i]) for i in np.linspace(0, len(order) - 1, 8).astype(int)]  # widest spread of focal lengths
pts = ds.pc_gt[torch.randperm(len(ds.pc_gt))[:300]].float()
# one small cube per point
cube_v = torch.tensor([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], dtype=torch.float) * 0.012
cube_f = torch.tensor([[0,1,3],[0,3,2],[4,6,7],[4,7,5],[0,4,5],[0,5,1],[2,3,7],[2,7,6],[0,2,6],[0,6,4],[1,5,7],[1,7,3]])
V = (pts[:, None] + cube_v[None]).reshape(-1, 3)
F = (cube_f[None] + 8 * torch.arange(len(pts))[:, None, None]).reshape(-1, 3)
mesh = Meshes([V], [F], TexturesVertex([torch.ones_like(V)]))
B = len(views)
K = torch.stack([ds.KRT[i][0] for i in views]).float()
R = torch.stack([ds.KRT[i][1] for i in views]).float()
T = torch.stack([ds.KRT[i][2] for i in views]).float()
model.renderer.update_cameras(K=K[0:1])  # what DBW does: first batch's K becomes the camera default
def hits(alpha):
    out = []
    for b in range(B):
        cam = PerspectiveCameras(K=K[b:b+1], R=R[b:b+1], T=T[b:b+1], in_ndc=True, image_size=((H, W),))
        xy = cam.transform_points_screen(pts[None], image_size=((H, W),))[0, :, :2].round().long()
        ok = (xy[:, 0] >= 0) & (xy[:, 0] < W) & (xy[:, 1] >= 0) & (xy[:, 1] < H)
        a = alpha[b, 0][xy[ok, 1], xy[ok, 0]]
        out.append(((a > 0.5).float().sum() / len(pts)).item())
    return np.array(out)
with torch.no_grad():
    a_old = model.renderer(mesh.extend(B), R=R, T=T)[:, 3:]
    a_new = model.renderer(mesh.extend(B), R=R, T=T, K=K)[:, 3:]
    edges = model.renderer.render_edges(mesh.extend(B), R, T, image_size=(H, W), K=K)
print('views', views, 'fx_px', fx[views].round(2) * min(H, W) / 2)
print('shared K   hit rate per view', hits(a_old).round(2))
print('per-view K hit rate per view', hits(a_new).round(2))
print('render_edges with K hit rate', hits((edges > 0).float()).round(2))

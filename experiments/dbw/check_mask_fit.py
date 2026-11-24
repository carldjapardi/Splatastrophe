"""Mask-only DBW fit on CPU, old (one shared K) vs new (per-view K). Same seed, views, init and steps.
Run from the DBW repo root with both patches applied:
    python <splatastrophe>/experiments/dbw/check_mask_fit.py {old,new} STEPS OUT.npz [THREADS]
Only the mask, parsimony and overlap losses are used (no rgb), starting in the coarse phase. Batch 2."""
import sys, time, copy, numpy as np, torch
sys.path.insert(0, 'src')
from utils import load_yaml
from utils.path import CONFIGS_PATH
from model import create_model
from optimizer import create_optimizer
from dataset.phototourism import PhototourismDataset
mode, steps, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
torch.manual_seed(0); np.random.seed(0); torch.set_num_threads(int(sys.argv[4]) if len(sys.argv) > 4 else 4)
cfg = load_yaml(CONFIGS_PATH / 'phototourism/brandenburg_v2.yml')
ds = PhototourismDataset('train', tag='brandenburg_v2', on_disk=False)
model = create_model(copy.deepcopy(cfg), ds.img_size)
model.loss_weights = {k: v for k, v in model.loss_weights.items() if k in ('mask', 'parsimony', 'overlap')}
opt = create_optimizer(cfg, model)
fx = np.array([float(k[0][0, 0]) for k in ds.KRT])
views = [int(v) for v in np.argsort(fx)[np.linspace(0, len(fx) - 1, 24).astype(int)]]
def batch(ids):
    items = [ds[i][0] for i in ids]
    return {k: torch.stack([it[k] for it in items]) for k in items[0]}
data = {i: batch([i]) for i in views}
def make(ids, with_K):
    b = {k: torch.cat([data[i][k] for i in ids]) for k in data[ids[0]]}
    if not with_K: b.pop('K')
    return b
# what upstream DBW does: the first batch's K becomes the only K
first = make(views[:4], True)
for r in (model.renderer, model.renderer_fine, model.renderer_env, model.renderer_light):
    r.update_cameras(K=first['K'][0:1])
def iou_all():
    model.eval(); res = []
    with torch.no_grad():
        for i in views:
            b = make([i], True)  # always score with the view's true K
            model.predict(b, None)
            a = (model._blocks_alpha[0, 0] > 0.5); m = b['masks'][0, 0]
            keep = (m != 0.5); g = m > 0.75
            res.append(((a & g & keep).sum() / ((a | g) & keep).sum().clamp(min=1)).item())
    model.train(); return np.array(res)
iou0 = iou_all(); t0 = time.time(); log = []
rng = np.random.default_rng(0)
for s in range(steps):
    ids = list(rng.choice(views, 2, replace=False))
    b = make(ids, mode == 'new')
    rec = model.predict(b, None)
    losses = model.compute_losses(b['imgs'], rec, masks=b['masks'])
    loss = sum(losses[k] for k in model.loss_weights)
    opt.zero_grad(); loss.backward(); opt.step()
    log.append(losses['mask'].item())
    if s % 25 == 0 or s == steps - 1:
        print(f'{mode} step {s} mask {np.mean(log[-25:]):.4f} {time.time() - t0:.0f}s', flush=True)
iou1 = iou_all()
alpha = torch.sigmoid(model.alpha_logit).detach().numpy() if hasattr(model, 'alpha_logit') else None
print(f'{mode} IoU mean {iou0.mean():.3f} -> {iou1.mean():.3f}; median {np.median(iou1):.3f}')
# coverage images for a figure
with torch.no_grad():
    model.eval(); figs = []
    for i in views[::4]:
        b = make([i], True); model.predict(b, None)
        figs.append((b['imgs'][0].numpy(), b['masks'][0, 0].numpy(), model._blocks_alpha[0, 0].numpy()))
np.savez(out, views=views, fx=fx[views], iou0=iou0, iou1=iou1, log=np.array(log),
         imgs=np.stack([f[0] for f in figs]), masks=np.stack([f[1] for f in figs]), cov=np.stack([f[2] for f in figs]))

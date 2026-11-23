# Differentiable Blocks World on the Brandenburg Gate

[Issue #30](https://github.com/carldjapardi/Splatastrophe/issues/30) · plan section 7 · owner Yushan (`claude-yushan-physics`)

This folder runs [Differentiable Blocks World](https://arxiv.org/abs/2307.05473) (DBW, Monnier et al. 2023) on the IMC-PT PhotoTourism Brandenburg Gate. The goal is to test whether its blocks can group the gate's splats into parts for physics. It does not need Nerfstudio: the upstream Nerfstudio loader requires a trained nerfstudio 0.1.15 Nerfacto model, so this reads the supplied COLMAP model directly.

| File | Purpose |
| --- | --- |
| `prep_phototourism.py` | Converts the IMC-PT COLMAP dense model into a DBW dataset: crops images, normalizes cameras, and writes sanity-check overlays |
| `phototourism.py` | DBW dataset class. Copy it to `src/dataset/phototourism.py` in the DBW repo |
| `brandenburg.yml` | v1 training config. Copy it to `configs/phototourism/brandenburg.yml` |
| `2026-11-23-gate-v1.md` | v1 run record and failure analysis |

## Setup

1. Clone [monniert/differentiable-blocksworld](https://github.com/monniert/differentiable-blocksworld) and create its conda env (python 3.8, pytorch 1.12.1, pytorch3d 0.7.1, cudatoolkit 11.3).
2. Register the loader in `src/dataset/__init__.py`:
   ```python
   from .phototourism import PhototourismDataset
   # and in the datasets dict:
   'phototourism': PhototourismDataset,
   ```
3. Download IMC-PT 2020 `brandenburg_gate` and the NeRF-W split `brandenburg.tsv`.

## Run

```bash
MKL_THREADING_LAYER=GNU python prep_phototourism.py \
  --scene <imc-pt>/brandenburg_gate/dense --tsv <path>/brandenburg.tsv \
  --out <dbw-repo>/datasets/phototourism/brandenburg
cd <dbw-repo>
MKL_THREADING_LAYER=GNU python src/trainer.py --tag gate_v1 --config phototourism/brandenburg.yml
```

Check `check_*.jpg` in the dataset folder before training. The red sparse points should sit on the gate and the green grid should lie on the plaza.

## Coordinate frame

DBW uses +y up. The prep script puts the plaza at y = −0.9, scales the gate to 1.4 units tall, and aligns its long axis with x. `cameras.npz` stores the transform from COLMAP to this frame as `c`, `A`, `s`:

```
x_dbw = s * A @ (x_colmap - c)
```

To map splats into the block frame, first undo the reconstruction's own pose normalization (Nerfstudio `dataparser_transforms.json`, or the transform recorded for the Spirula export) to get back to COLMAP coordinates, then apply this transform.

## Environment notes

- Without `MKL_THREADING_LAYER=GNU`, numpy matmuls deadlock in the DBW env.
- `opencv-python` needs libGL. Use `opencv-python-headless==4.6.0.66`.
- `open3d` needs libX11 and libGL. If a conda install hangs, put those libraries on `LD_LIBRARY_PATH`.
- The final qualitative eval can crash with `CUDA error: misaligned address` in MAGMA while writing a trajectory video. This happens after `model.pkl` is saved.

# Reconstruction development

Use the existing private repository: https://github.com/SriyaKan/Splatastrophe. VS Code is the editor, Thunder or Colab provides GPU compute, GitHub stores code, and Vercel hosts the eventual website. Colab is not the website host.

## VS Code and Thunder

1. Install VS Code if needed, then open `Splatastrophe.code-workspace`. Accept the recommended Python, Jupyter, Remote SSH and Thunder Compute extensions.
2. Sign in to Thunder in its extension using your own account. Select an appropriate GPU instance and connect; provisioning starts account usage, so check the displayed rate/remaining credit first.
3. In the resulting Remote SSH window, clone this private repository using your own GitHub authorization (`gh auth login`, then `gh repo clone SriyaKan/Splatastrophe`). Open that remote checkout, not the local Mac folder.
4. Create a separate reconstruction environment below. Install `requirements-dev.txt` there to run notebook cells and choose that interpreter as the notebook kernel. Run `scripts/check_runtime.py` to confirm that commands run on the remote GPU.
5. Run reconstruction stages below; save outputs before stopping/deleting the instance. Stop idle compute through Thunder. Credit is per account; each teammate runs their own assigned work and records usage.

Thunder connection documentation: https://www.thundercompute.com/docs/vscode/operations/connecting-to-instances

## GPU environment

Do not install the GPU research stack into the Mac system Python. Start with a Linux NVIDIA GPU runtime with a CUDA toolkit/compiler (`nvcc`), compatible driver and Python 3.10 environment. Use the current official Nerfstudio installation instructions to choose matching PyTorch/CUDA builds:
https://docs.nerf.studio/quickstart/installation.html

After installing compatible PyTorch/CUDA and required build dependencies in that environment:

```bash
python -m pip install nerfstudio
python -m pip install -r requirements-dev.txt
python scripts/check_runtime.py
ns-train splatfacto --help
colmap -h
ffmpeg -version
```

Install COLMAP and FFmpeg on the GPU machine if missing. CUDA extensions may need compiler setup/compilation. This scaffold deliberately does not replace Colab's PyTorch build or pin an untested CUDA combination. Once a GPU smoke test succeeds, save `python -m pip freeze` and driver/toolkit details alongside its run logs to establish the tested environment. DBW and PhysGaussian use separate environments.

## Colab alternative

Open https://colab.research.google.com/github/SriyaKan/Splatastrophe/blob/main/notebooks/00_runtime_setup.ipynb and authorize GitHub access to the private repo. If direct opening fails, use File > Open notebook > GitHub (include private repos), or upload the notebook.

Select Runtime > Change runtime type > GPU. Add a Colab secret `GITHUB_TOKEN` with read access to this repository and enable notebook access. The notebook clones without putting that credential into cells or the repository URL. Install the reconstruction environment in this runtime, then run the cells one stage at a time. GPU availability and package compatibility must be checked on each runtime. Paid Colab is optional; it does not require changing repository formats.

Colab VMs are temporary. Copy checkpoints/exports to persistent storage before disconnecting. A shared notebook does not share its VM, credentials or installed packages. Prefer Thunder for VS Code Remote SSH; the Colab path uses the notebook UI.

Colab documentation: https://research.google.com/colaboratory/faq.html

## Barn reconstruction

Download only the Barn image set from https://www.tanksandtemples.org/download/ and extract image files into `data/raw/barn/images/`. Respect the dataset attribution/terms. Large data and outputs are ignored by Git.

This baseline estimates cameras using COLMAP. Supplied Tanks and Temples camera conversion is future work, not implemented. After processing, inspect alignment before training. The scene JSON records provenance, paths, evaluation interval and a short 1000-iteration baseline; that iteration count is a smoke test, not a quality promise.

```bash
# Commands preview by default; append --execute when ready to run.
python pipeline/reconstruction/run.py process --execute
python pipeline/reconstruction/run.py split --execute
python pipeline/reconstruction/run.py train --execute
# Use the exact config.yml from the successful training run:
python pipeline/reconstruction/run.py eval --load-config outputs/barn/PATH/TO/config.yml --execute
python pipeline/reconstruction/run.py export --load-config outputs/barn/PATH/TO/config.yml --execute
```

The splitter persists explicit train/val/test filenames in transforms.json and refuses to overwrite existing splits. Validation and test share the held-out views in this first baseline; do not tune on those views and present them as untouched test results. COLMAP uses all photographs for camera estimation; held-out images are excluded from appearance training. For tuning experiments, create three disjoint splits first.

Command logs live under `outputs/barn/command-logs/`; evaluation and exports live beside the selected training config. Log actual compute charges manually. Checkpoints and exports require explicit copying to persistent storage. Export remains in reconstruction coordinates: Y-up alignment, metric scale, foreground cropping, proxy creation and browser verification are subsequent tasks, not automatically completed by this script.

## Local checks (no GPU or dependencies needed)

```bash
python3 -m unittest discover -s tests -v
python3 scripts/check_runtime.py
python3 pipeline/reconstruction/run.py train
```

Notebook commands preview by default (`EXECUTE = False`). Do not commit token values, credentials, raw data, model files, or notebook outputs.

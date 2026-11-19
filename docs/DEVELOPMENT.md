# Reconstruction development

Workstream: [issue #2](https://github.com/carldjapardi/Splatastrophe/issues/2), branch `sriya/reconstruction`. Open `Splatastrophe.code-workspace` in VS Code. Reconstruction has its own Linux NVIDIA GPU environment; DBW and PhysGaussian must use separate environments. The website remains a separate viewer project.

## Connect Thunder first

1. Sign in through the Thunder VS Code extension. Inspect the displayed instance rate and remaining credit; connect to the intended Linux NVIDIA instance. Prefer at least 16 GB VRAM to leave room beyond Splatfacto's documented default footprint. GPU suitability is not established by its advertised VRAM alone.
2. Install/use Remote SSH; click Connect for the running instance. The new VS Code window must show an SSH target in its lower-left corner. Commands in that window run remotely.
3. Use your existing GitHub authentication on that machine. Clone this repository and select `sriya/reconstruction`; do not paste credentials into cells, URLs or chat. This repository currently resolves from SriyaKan/Splatastrophe to carldjapardi/Splatastrophe.
4. Put large data/output folders on the instance's persistent disk. Check `df -h` before downloading; Brandenburg Gate alone is approximately 4 GB compressed, and extraction, image copies and checkpoints require substantially more space. Confirm Thunder's storage lifecycle and save artifacts before stopping/deleting the instance.

Official connection instructions: https://www.thundercompute.com/docs/vscode/operations/connecting-to-instances

## Inspect and install the GPU environment

Before installing anything, collect:

```bash
nvidia-smi
nvcc --version
python --version
python scripts/check_runtime.py --output outputs/runtime-before.json
```

Use an isolated Python 3.10 or 3.11 Linux environment, for example a conda environment named `splat-reconstruction`. Install a CUDA-enabled PyTorch/torchvision pair appropriate to the GPU, driver and compiler, following https://docs.nerf.studio/quickstart/installation.html and https://pytorch.org/get-started/locally/. Do not replace a Colab or Thunder preinstalled PyTorch build blindly. Driver compatibility alone does not establish that CUDA extensions compile.

Once CUDA PyTorch works and `nvcc` is available:

```bash
bash scripts/install_reconstruction.sh
python -m pip install -r requirements-dev.txt
python scripts/check_runtime.py --require-gpu --output outputs/runtime.json
colmap -h
ffmpeg -version
```

The installation helper pins Nerfstudio 1.1.5 and NumPy below 2, checks dependencies and CLI availability. It does not provision compute, install a driver, choose the CUDA/PyTorch build, or prove gsplat kernel compatibility. Install COLMAP/FFmpeg if absent, using the machine's package manager or an appropriate conda package. A first 1,000-iteration training run is the CUDA smoke test. Save the runtime report and pip freeze with the result. The helper is a proposed recipe until validated on the selected GPU.

## Run one scene at a time

Commands preview by default. `--execute` performs the selected stage. Use an absolute storage root on the GPU if data should live outside the checkout. Scene configuration paths are relative to that storage root; source/configuration files stay in the checkout.

```bash
# Select Barn first; use configs/scenes/brandenburg-gate.json for PhotoTourism later.
SCENE=configs/scenes/barn.json
SPLAT_DATA_ROOT="$PWD"  # Replace with a persistent mount if available.
python pipeline/reconstruction/run.py download --scene "$SCENE" --data-root "$SPLAT_DATA_ROOT" --execute
python pipeline/reconstruction/run.py process --scene "$SCENE" --data-root "$SPLAT_DATA_ROOT" --execute
python pipeline/reconstruction/run.py split --scene "$SCENE" --data-root "$SPLAT_DATA_ROOT" --execute
python pipeline/reconstruction/run.py inspect --scene "$SCENE" --data-root "$SPLAT_DATA_ROOT" --execute
```

Download preserves the source archive, records URL/retrieval time/archive SHA256 in `data/raw/.../source.json`, and refuses to replace an existing raw directory. The SHA256 records local content identity; it is not a verified upstream checksum. Interrupted downloads are retained for diagnosis; inspect the incomplete directory and choose a new root rather than deleting known-good data.

For already-downloaded data, place Barn images at `data/raw/barn/images/`. For PhotoTourism use `data/raw/phototourism/brandenburg-gate/dense/images/`, the binary COLMAP files in `dense/sparse/`, and `brandenburg.tsv` beside `dense/`. Preserve the exact archive and source metadata; do not silently substitute another dataset release.

Open `data/processed/<scene>/alignment.html`, inspect registered camera coverage and the COLMAP sparse cloud, and check the registration fraction in `alignment.json`. Structural validation checks matrices, intrinsics, image existence and split consistency; it cannot establish visually correct alignment. Stop and investigate disconnected cameras, a low registration fraction or implausible sparse geometry before training. For PhotoTourism, the report separates all registered cameras from the subset retained by the split.

```bash
# First run stays short. --hourly-rate-usd RATE optionally records a stage cost estimate.
python pipeline/reconstruction/run.py train --scene "$SCENE" --data-root "$SPLAT_DATA_ROOT" --execute
# Copy the exact config path printed by the successful run:
TRAIN_CONFIG=/absolute/path/to/outputs/barn/barn/splatfacto/TIMESTAMP/config.yml
python pipeline/reconstruction/run.py eval --scene "$SCENE" --data-root "$SPLAT_DATA_ROOT" --load-config "$TRAIN_CONFIG" --execute
python pipeline/reconstruction/run.py export --scene "$SCENE" --data-root "$SPLAT_DATA_ROOT" --load-config "$TRAIN_CONFIG" --execute
python pipeline/reconstruction/run.py preview --scene "$SCENE" --data-root "$SPLAT_DATA_ROOT" --load-config "$TRAIN_CONFIG" --execute
```

Use a new timestamp/run for each experiment. `--iterations N` changes the training length; run a longer job only after inspecting the short run, exported PLY and browser rendering. Command logs include elapsed wall time, failures/interruption, exact arguments, Git state and scene configuration. Training logs also save pip freeze and nvidia-smi. Optional rate-based cost is a stage wall-time estimate excluding setup/idle/storage; record actual provider charges separately. Training provenance hashes the exact processed cameras/splits and rejects later export/evaluation after they change.

### Barn

Source: https://www.tanksandtemples.org/download/ . The official training `Barn.zip` image set contains video-sampled frames. The downloader targets only Barn through the file ID published in the official downloader. Respect https://www.tanksandtemples.org/license/ .

We run COLMAP with sequential matching on these ordered frames, then Nerfstudio processing creates image pyramids. The initial Splatfacto job uses downscale factor 4. Supplied Tanks and Temples camera logs do not include exact intrinsics; their conversion remains unimplemented and is not required for this baseline.

The deterministic appearance split is approximately 80/10/10 train/validation/test in filename order. All views may contribute to camera estimation. The appearance splits are disjoint; nearby video frames remain correlated. Do not use the test subset to tune hyperparameters.

### PhotoTourism: Brandenburg Gate

Use `--scene configs/scenes/brandenburg-gate.json` for every stage. The exact source is the [IMC-PT 2020 Brandenburg Gate archive](https://www.cs.ubc.ca/~kmyi/imw2020/data.html), paired with the [NeRF-W filename split](https://nerf-w.github.io/data/selected_images/brandenburg.tsv). PhotoTourism is a separate reconstruction, not additional Barn training views.

Reuse the archive's binary COLMAP cameras/points. Images are copied with their original names; `ns-process-data --skip-colmap --skip-image-processing` converts the supplied model with per-camera intrinsics retained. No fresh SfM job or approximate shared focal length is substituted. The original archive/split hashes identify the release actually used. The initial job uses the archive image resolution (factor 1).

Keep the official NeRF-W test membership, take validation views only from the official training pool, and exclude unlisted images from appearance training. Missing listed cameras are errors, not silently dropped test views. Our baseline reports full-image Splatfacto metrics without appearance adaptation; it does **not** reproduce the NeRF-W half-image/appearance-adapted evaluation protocol. Lighting/exposure differences, tourists and sky are expected failure cases of vanilla Splatfacto. Splatfacto-W is a possible later controlled experiment, not part of this baseline.

## Export handoff

Each successful export creates `exports/building.ply`, `artifact.json`, `scene.json`, the input cameras, split and alignment report; it copies available metrics and `dataparser_transforms.json`. Validation renders are stored separately under `preview/`. Copy the exact training config/checkpoint, command logs, runtime report, source metadata and preview alongside exports when persisting or sharing internally.

The PLY is in Nerfstudio training coordinates. Input cameras are in pre-dataparser coordinates; preserve the recorded transform/scale between them. No metric scale, Y-up viewer conversion, foreground cropping, physical components, lighting proxy or browser verification is claimed. PLY row indices identify splats only within the exact exported content hash; upstream export may filter/reorder them. Validate orientation, covariance, SH ordering and appearance in the browser before a handoff to Carl/Isaac is marked complete. Do not publish dataset photos or assets without checking redistribution rights.

## Colab alternative

Open `notebooks/00_runtime_setup.ipynb` from this branch using File > Open notebook > GitHub (including private repositories) or upload it. Select a GPU runtime and use the same separate environment checks. The notebook supports Barn and Brandenburg Gate through `SCENE` and `DATA_ROOT`; execution is opt-in. A Colab `GITHUB_TOKEN` secret is used only for a temporary askpass helper, never stored in the clone URL. Select the branch containing this notebook. Keep outputs on mounted persistent storage; Colab VMs are temporary. See https://research.google.com/colaboratory/faq.html .

## Local verification

```bash
python3 -m unittest discover -s tests -v
python3 scripts/check_runtime.py
python3 pipeline/reconstruction/run.py train
python3 pipeline/reconstruction/run.py process --scene configs/scenes/brandenburg-gate.json
```

Local tests use tiny synthetic metadata/archive fixtures. Passing them establishes pipeline behavior, not real camera alignment, reconstruction quality or CUDA compatibility. Never commit raw data, checkpoints, tokens or notebook outputs.

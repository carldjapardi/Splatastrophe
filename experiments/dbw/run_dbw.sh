#!/usr/bin/env bash
# Set up DBW on a fresh Linux GPU instance (NVIDIA driver already installed) and train one or more runs in sequence.
# Inputs in ~/dbw_run: dbw_masks.patch, dbw_per_view_K.patch, register_loader.patch, phototourism.py, the configs and
# dataset tarballs. Each job is TAG:CONFIG.yml:DATASET.tar.gz, for example
#   bash ~/dbw_run/run_dbw.sh synth_v1:synthetic_faults.yml:synthetic_faults.tar.gz gate_v2k:brandenburg_v2.yml:brandenburg_v2.tar.gz
# Progress goes to stdout; each trainer log goes to ~/work/<tag>.log. Prints RUN_DONE at the end.
set -o pipefail
log(){ echo "[$(date +%H:%M:%S)] $*"; }
I=~/dbw_run
cd ~
if [ ! -d ~/miniforge3 ]; then
  log "install miniforge"
  curl -fsSL -o mf.sh https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh && bash mf.sh -b -p ~/miniforge3 && rm mf.sh
fi
source ~/miniforge3/etc/profile.d/conda.sh
mkdir -p ~/work && cd ~/work
[ -d differentiable-blocksworld ] || git clone -q https://github.com/monniert/differentiable-blocksworld.git
cd differentiable-blocksworld && git checkout -q fb08bd1 && log "DBW at $(git log --oneline -1)"
log "system GL/X11 libs"
(sudo -n apt-get -qq update && sudo -n DEBIAN_FRONTEND=noninteractive apt-get -qq install -y libgl1 libx11-6 libxext6 libxrender1 libgomp1) > ~/work/apt.log 2>&1 || log "apt failed (see apt.log)"
log "conda env"
conda env list | grep -q '^dbw ' || conda env create -q -f environment.yml > ~/work/dbw_env.log 2>&1
conda activate dbw || { log "ENV_FAILED"; exit 1; }
pip uninstall -y -q opencv-python && pip install -q opencv-python-headless==4.6.0.66
log "patches + loader"
if [ ! -f src/dataset/phototourism.py ]; then
  git apply $I/dbw_masks.patch && git apply $I/dbw_per_view_K.patch && git apply $I/register_loader.patch || { log "PATCH_FAILED"; exit 1; }
  cp $I/phototourism.py src/dataset/
fi
mkdir -p configs/phototourism datasets/phototourism
cd src && MKL_THREADING_LAYER=GNU timeout 300 python -c "import open3d, trainer, torch; print('imports OK, cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0))" || { log "IMPORT_FAILED"; exit 1; }
cd ..
for job in "$@"; do
  IFS=: read -r tag cfg tarball <<< "$job"
  cp $I/$cfg configs/phototourism/
  tar xzf $I/$tarball -C datasets/phototourism
  log "TRAIN_START $tag ($cfg)"
  MKL_THREADING_LAYER=GNU CUDA_VISIBLE_DEVICES=0 python src/trainer.py --tag $tag --config phototourism/$cfg > ~/work/$tag.log 2>&1
  log "TRAIN_EXIT $tag=$? model=$(ls runs/phototourism/$tag/model.pkl 2>/dev/null)"
done
log "RUN_DONE"

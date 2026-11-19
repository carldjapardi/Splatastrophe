#!/usr/bin/env bash
# Run inside an isolated Linux GPU environment AFTER installing a matching CUDA PyTorch build.
set -euo pipefail
python - <<'PY'
import sys, platform, os
if platform.system() != 'Linux' or sys.version_info[:2] not in ((3,10), (3,11)):
    raise SystemExit('Use an isolated Linux Python 3.10 or 3.11 environment for this recipe.')
if sys.prefix == sys.base_prefix and not os.environ.get('CONDA_PREFIX'):
    raise SystemExit('Activate a dedicated reconstruction conda/venv environment first.')
import torch
if not torch.cuda.is_available():
    raise SystemExit('Install the CUDA-enabled PyTorch build matching this instance first.')
print('PyTorch:',torch.__version__,'CUDA:',torch.version.cuda,'GPU:',torch.cuda.get_device_name(0))
PY
command -v nvcc >/dev/null || { echo 'CUDA compiler nvcc is missing; install a toolkit compatible with PyTorch before gsplat.'; exit 1; }
python -m pip install 'numpy<2' 'nerfstudio==1.1.5' ninja
python -m pip check
python scripts/check_runtime.py --require-gpu --output outputs/runtime.json
ns-train splatfacto --help >/dev/null
ns-process-data images --help >/dev/null
ns-export gaussian-splat --help >/dev/null
ns-render dataset --help >/dev/null
echo 'CLI checks passed. A short training job must still validate compiled gsplat CUDA kernels.'

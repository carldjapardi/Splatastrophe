"""Inspect a runtime without installation; --require-gpu fails before expensive work."""
import argparse
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys


def capture(command):
    if not shutil.which(command[0]):
        return None
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        return {'returncode': result.returncode, 'output': (result.stdout + result.stderr).strip()}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'returncode': 1, 'output': str(error)}


def report():
    versions = {}
    for package in ('torch', 'torchvision', 'nerfstudio', 'gsplat', 'numpy'):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    result = {'python': sys.version, 'executable': sys.executable, 'platform': platform.platform(),
              'packages': versions, 'commands': {name: shutil.which(name) for name in
              ('ns-process-data', 'ns-train', 'ns-eval', 'ns-export', 'ns-render', 'colmap', 'ffmpeg', 'nvcc')},
              'nvidia_smi': capture(['nvidia-smi']), 'cuda_compiler': capture(['nvcc', '--version']), 'cuda_available': False}
    if importlib.util.find_spec('torch'):
        try:
            import torch
            result['cuda_available'] = torch.cuda.is_available()
            result['torch_cuda'] = torch.version.cuda
            if result['cuda_available']:
                device = torch.cuda.get_device_properties(0)
                result['gpu'] = {'name': device.name, 'memory_bytes': device.total_memory,
                                 'compute_capability': list(torch.cuda.get_device_capability(0))}
        except Exception as error:
            result['torch_error'] = str(error)
    result['ready_for_training'] = bool(result['cuda_available'] and versions['nerfstudio'] and versions['gsplat']
                                         and all(result['commands'][name] for name in ('ns-train', 'ns-eval', 'ns-export', 'ns-render', 'nvcc')))
    result['note'] = 'Readiness is structural; run a short training job to test compiled gsplat kernels. COLMAP/FFmpeg are also required for Barn preparation.'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--require-gpu', action='store_true')
    args = parser.parse_args()
    result = report()
    text = json.dumps(result, indent=2)
    print(text)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + '\n')
    if args.require_gpu and not result['ready_for_training']:
        raise SystemExit('GPU reconstruction environment is not ready; inspect the missing packages/commands above')


if __name__ == '__main__':
    main()

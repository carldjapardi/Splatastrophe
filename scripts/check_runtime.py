"""Portable runtime check; does not install packages or require a GPU."""
import importlib.util
import platform
import shutil
import subprocess
import sys


def main():
    print("Python:", sys.version.split()[0])
    print("Platform:", platform.platform())
    if shutil.which("nvidia-smi"):
        subprocess.run(["nvidia-smi"], check=True)
    else:
        print("No nvidia-smi found. Local editing works; CUDA experiments need a GPU runtime.")
    if importlib.util.find_spec("torch"):
        import torch
        print("PyTorch:", torch.__version__)
        print("CUDA available:", torch.cuda.is_available())
        if torch.cuda.is_available():
            print("GPU:", torch.cuda.get_device_name(0))
    else:
        print("PyTorch is not installed. Install the selected experiment environment separately.")


if __name__ == "__main__":
    main()

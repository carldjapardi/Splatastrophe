"""Fetch pinned official EMS code and apply headless/NumPy compatibility fixes.

The MIT-licensed dependency stays outside Git in external/. No fitting logic is
changed by ems-headless.patch; visualization imports become lazy, np.int -> int.
"""

import argparse
import subprocess
from pathlib import Path

EMS_COMMIT = "5a213d46e8b013b5a153f5aa914b0925ee517af7"
EMS_URL = "https://github.com/bmlklwx/EMS-superquadric_fitting.git"
DEFAULT_CHECKOUT = Path(__file__).resolve().parents[2] / "external/EMS-superquadric_fitting"


def prepare(path):
    path = Path(path).resolve()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--no-checkout", EMS_URL, str(path)], check=True)
        subprocess.run(["git", "-C", str(path), "checkout", "--detach", EMS_COMMIT], check=True)
    actual = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    if actual != EMS_COMMIT:
        raise ValueError(f"EMS checkout is {actual}, expected {EMS_COMMIT}; use a separate checkout")
    patch = Path(__file__).with_name("ems-headless.patch")
    applied = subprocess.run(["git", "-C", str(path), "apply", "--reverse", "--check", str(patch)], capture_output=True)
    if applied.returncode:
        subprocess.run(["git", "-C", str(path), "apply", "--check", str(patch)], check=True)
        subprocess.run(["git", "-C", str(path), "apply", str(patch)], check=True)
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, default=DEFAULT_CHECKOUT)
    print(prepare(parser.parse_args().checkout))

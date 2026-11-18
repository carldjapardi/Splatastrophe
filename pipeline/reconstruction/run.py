"""Nerfstudio reconstruction commands. Dry-run by default; --execute runs work."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def split_frames(path, every):
    """Persist explicit appearance splits; cameras may have used all images."""
    meta = json.loads(path.read_text())
    frames = sorted(meta["frames"], key=lambda f: f["file_path"])
    names = [f["file_path"] for f in frames]
    if len(names) < 3 or len(set(names)) != len(names):
        raise ValueError("Need at least three uniquely named registered images")
    if every < 2:
        raise ValueError("eval_every must be at least 2")
    for name in names:
        if not (path.parent / name).is_file():
            raise ValueError(f"Missing registered image: {name}")
    test = names[every - 1::every] or names[-1:]
    train = [n for n in names if n not in set(test)]
    keys = ("train_filenames", "val_filenames", "test_filenames")
    if any(k in meta for k in keys):
        raise ValueError("Splits already exist; inspect them instead of overwriting")
    meta.update(train_filenames=train, val_filenames=test, test_filenames=test)
    # This baseline shares validation/test views; do not tune on these views and call them an untouched test set.
    path.with_suffix(".before-split.json").write_text(path.read_text())
    path.write_text(json.dumps(meta, indent=2) + "\n")
    return {"train": train, "evaluation": test, "policy": "shared validation/test baseline; no tuning on held-out views"}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("stage", choices=["process", "split", "train", "eval", "export"])
    p.add_argument("--scene", type=Path, default=ROOT / "configs/scenes/barn.json")
    p.add_argument("--load-config", type=Path, help="Exact Nerfstudio run config.yml; required for eval/export")
    p.add_argument("--execute", action="store_true")
    a = p.parse_args()
    cfg = json.loads(a.scene.read_text())
    images, processed, outputs = [ROOT / cfg[k] for k in ("images", "processed", "outputs")]
    transforms = processed / "transforms.json"
    if a.stage == "split":
        if not a.execute:
            print(f"Would create explicit splits in {transforms}")
            return
        result = split_frames(transforms, cfg["eval_every"])
        (processed / "split.json").write_text(json.dumps(result, indent=2) + "\n")
        print(f"Split saved: {len(result['train'])} train, {len(result['evaluation'])} evaluation")
        return
    if a.stage == "process":
        cmd = ["ns-process-data", "images", "--data", str(images), "--output-dir", str(processed)]
    elif a.stage == "train":
        cmd = ["ns-train", "splatfacto", "--data", str(processed), "--output-dir", str(outputs),
               "--max-num-iterations", str(cfg["iterations"]), "--vis", "tensorboard"]
    else:
        if not a.load_config:
            p.error("--load-config is required for eval/export; choose the exact successful training run")
        config = a.load_config.resolve()
        if a.stage == "eval":
            cmd = ["ns-eval", "--load-config", str(config), "--output-path", str(config.parent / "metrics.json")]
        else:
            cmd = ["ns-export", "gaussian-splat", "--load-config", str(config), "--output-dir", str(config.parent / "exports")]
    print(shlex.join(cmd))
    if not a.execute:
        return
    if not shutil.which(cmd[0]):
        p.error(f"Missing {cmd[0]}; activate the reconstruction environment")
    if a.stage == "process" and not any(images.rglob("*.[jJ][pP][gG]")) and not any(images.rglob("*.png")):
        p.error(f"Download/extract scene images to {images} first")
    if a.stage == "process" and transforms.exists():
        p.error("Processed transforms exist; use a new processed directory to avoid replacing results")
    if a.stage == "train":
        meta = json.loads(transforms.read_text())
        if not meta.get("train_filenames") or not meta.get("test_filenames"):
            p.error("Run split --execute before training")
    if a.stage in ("eval", "export") and not config.is_file():
        p.error(f"Run config does not exist: {config}")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    logdir = outputs / "command-logs" / stamp
    logdir.mkdir(parents=True, exist_ok=False)
    record = {"command": cmd, "scene": cfg, "cwd": str(ROOT), "started_utc": stamp}
    (logdir / "run.json").write_text(json.dumps(record, indent=2))
    with (logdir / "console.log").open("w") as log:
        process = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            for line in process.stdout:
                print(line, end="", flush=True)
                log.write(line)
                log.flush()
            status = process.wait()
        except KeyboardInterrupt:
            process.terminate()
            process.wait()
            raise
    record.update(returncode=status, finished_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
    (logdir / "run.json").write_text(json.dumps(record, indent=2))
    if status:
        raise SystemExit(status)


if __name__ == "__main__":
    main()

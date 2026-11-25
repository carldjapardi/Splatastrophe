"""Reproducible full/shell comparison, with hard per-fit subprocess deadlines.

Train seed and independent evaluation seed are different. Labels are used only
by evaluation/figures. The best method maximizes the mean of full and shell
semantic voxel IoU, not the visual appeal or the gate reference score.
"""

import argparse
import csv
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from part_eval import PART_NAMES, evaluate, synthetic_points, true_primitives
from prepare_ems import DEFAULT_CHECKOUT


def surface(primitive, samples=20):
    eta, omega = np.meshgrid(np.linspace(-np.pi / 2, np.pi / 2, samples), np.linspace(-np.pi, np.pi, samples * 2))
    e1, e2 = primitive["eps"]

    def power(x, exponent):
        return np.sign(x) * abs(x) ** exponent

    xyz = np.stack([power(np.cos(eta), e1) * power(np.cos(omega), e2),
                    power(np.cos(eta), e1) * power(np.sin(omega), e2), power(np.sin(eta), e1)], axis=-1)
    xyz *= primitive["half_size"]
    return xyz @ np.array(primitive["rotation"]).T + primitive["center"]


def draw_solids(ax, primitives, mapping, names=PART_NAMES):
    colors = plt.get_cmap("tab10")
    for primitive, label in zip(primitives, mapping):
        grid = surface(primitive)
        color = colors(names.index(label)) if label in names else (.5, .5, .5, 1)
        ax.plot_surface(grid[:, :, 0], -grid[:, :, 2], grid[:, :, 1], color=color, alpha=.8,
                        linewidth=0, antialiased=False, shade=True, rcount=20, ccount=40)


def synthetic_figure(results, variant, output):
    from faults_geometry import authored_blocks, to_dbw
    truth = true_primitives()
    truth_mapping = [p["part"] for p in to_dbw(authored_blocks())[0]]
    fig = plt.figure(figsize=(14, 8))
    columns = [("Ground truth", truth, truth_mapping)] + [(method.upper(), row.get("primitives", []), row.get("mapping", [])) for method, row in results.items()]
    all_primitives = [p for _, primitives, _ in columns for p in primitives]
    low = np.min([np.array(p["center"]) - abs(np.array(p["rotation"])) @ p["half_size"] for p in all_primitives], axis=0)
    high = np.max([np.array(p["center"]) + abs(np.array(p["rotation"])) @ p["half_size"] for p in all_primitives], axis=0)
    margin = (high - low) * .03
    low, high = low - margin, high + margin
    for row, (elev, azim) in enumerate(((0, -90), (25, -55))):
        for col, (name, primitives, mapping) in enumerate(columns):
            ax = fig.add_subplot(2, 3, row * 3 + col + 1, projection="3d")
            draw_solids(ax, primitives, mapping)
            ax.view_init(elev=elev, azim=azim)
            ax.set(xlim=(low[0], high[0]), ylim=(-high[2], -low[2]), zlim=(low[1], high[1]), xlabel="x", ylabel="−z (depth)", zlabel="y (up)")
            if row == 0:
                ax.set_proj_type("ortho")
                ax.set_yticks([])
                ax.set_ylabel("")
            ax.set_box_aspect((high - low)[[0, 2, 1]])
            ax.set_title(f"{name} · {variant}" + (f" · mIoU {results[name.lower()]['mean_part_iou']:.3f}" if name.lower() in results and "mean_part_iou" in results[name.lower()] else ""))
    handles = [plt.Line2D([0], [0], color=plt.get_cmap("tab10")(i), lw=6, label=name) for i, name in enumerate(PART_NAMES)]
    fig.legend(handles=handles, loc="lower center", ncol=4)
    fig.tight_layout(rect=(0, .08, 1, 1))
    fig.savefig(output, dpi=140)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("outputs/route-c"))
    parser.add_argument("--points", type=int, default=12000)
    parser.add_argument("--seed", type=int, default=38)
    parser.add_argument("--k", type=int, default=32)
    parser.add_argument("--resolution", type=int, default=128)
    parser.add_argument("--ems-checkout", type=Path, default=DEFAULT_CHECKOUT)
    parser.add_argument("--timeout", type=int, default=840)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rows = []
    start = time.perf_counter()
    for variant in ("full", "shell"):
        points, _ = synthetic_points(variant, args.points, args.seed)
        train = args.out / f"{variant}-train.npy"
        np.save(train, points)
        evaluation_points, block_indices = synthetic_points(variant, args.points, args.seed + 1)
        np.savez_compressed(args.out / f"{variant}-evaluation.npz", points=evaluation_points, block_index=block_indices)
        results = {}
        for method in ("pca", "ems"):
            output = args.out / f"{method}-{variant}.json"
            command = [sys.executable, str(Path(__file__).with_name("fit_primitives_3d.py")), str(train),
                       "--method", method, "--output", str(output), "--k", str(args.k), "--seed", str(args.seed),
                       "--max-points", str(args.points), "--ems-checkout", str(args.ems_checkout), "--max-seconds", str(args.timeout)]
            wall = time.perf_counter()
            try:
                run = subprocess.run(command, timeout=args.timeout, capture_output=True, text=True,
                                     env={**os.environ, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "NUMBA_NUM_THREADS": "1"})
                (args.out / f"{method}-{variant}.log").write_text(run.stdout + run.stderr)
                if run.returncode:
                    raise RuntimeError(f"fit exited {run.returncode}; see {method}-{variant}.log")
                fitting_seconds = time.perf_counter() - wall
                fitted = json.loads(output.read_text())
                metrics = evaluate(fitted["primitives"], evaluation_points, block_indices, args.resolution)
                row = {"method": method, "variant": variant, "status": "ok", "train_points": len(points),
                       "fit_wall_seconds": fitting_seconds, **metrics}
                results[method] = {**metrics, "primitives": fitted["primitives"]}
            except (subprocess.TimeoutExpired, RuntimeError, ValueError) as exc:
                row = {"method": method, "variant": variant, "status": "failed", "reason": str(exc), "fit_wall_seconds": time.perf_counter() - wall}
                results[method] = row
            rows.append(row)
            print(json.dumps(row), flush=True)
        synthetic_figure(results, variant, args.out / f"{variant}-comparison.jpg")
    eligible = {m: np.mean([r["mean_part_iou"] for r in rows if r["method"] == m]) for m in ("pca", "ems")
                if sum(r["method"] == m and r["status"] == "ok" for r in rows) == 2}
    winner = max(eligible, key=eligible.get) if eligible else None
    report = {"rows": rows, "best_method": winner, "selection_scores": eligible,
              "selection_rule": "mean of full/shell mean part voxel IoU; fixed settings, no gate tuning",
              "settings": {"k": args.k, "max_points": args.points, "resolution": args.resolution, "timeout_seconds": args.timeout},
              "train_seed": args.seed, "evaluation_seed": args.seed + 1,
              "machine": platform.platform(), "python": platform.python_version(),
              "elapsed_seconds": time.perf_counter() - start}
    (args.out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    columns = ["method", "variant", "status", "train_points", "primitive_count", "mean_part_iou", "parts_over_0_5", "volume_iou", "point_assignment_accuracy", "fit_wall_seconds"]
    with (args.out / "results.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps({"best_method": winner, "selection_scores": eligible}), flush=True)


if __name__ == "__main__":
    main()

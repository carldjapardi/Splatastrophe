"""Fit the synthetic benchmark's winner to the gate without hand-fitted inputs.

The browser baseline is consulted only after fitting, as a coarse reference,
not as independently annotated ground truth. Original SOG indices are retained.
"""

import argparse
import hashlib
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
from threadpoolctl import threadpool_limits

from export_gate_browser_parts import assign as reference_assign, decode
from part_eval import assign_points, log_implicit_values
from prepare_ems import DEFAULT_CHECKOUT
from run_route_c import draw_solids


GATE_SHA256 = "79a08ca9a39e50000aa67fdd444f03ba4dd08319accec0196a1845596f769625"
NAMES = tuple([f"column {i + 1}" for i in range(6)] + ["attic/roof", "quadriga"])


def comparison_metrics(assignments, reference, mask, count):
    indices = np.arange(len(assignments))
    mapping_subset = mask & (indices % 2 == 0) & (reference >= 0)
    scoring_subset = mask & (indices % 2 == 1) & (reference >= 0)
    confusion = np.bincount(assignments[mapping_subset] * 8 + reference[mapping_subset], minlength=count * 8).reshape(count, 8)
    mapping = np.where(confusion.sum(axis=1), confusion.argmax(axis=1), -1)
    predicted, truth = mapping[assignments[scoring_subset]], reference[scoring_subset]
    ious = []
    for i in range(8):
        union = np.count_nonzero((predicted == i) | (truth == i))
        ious.append(float(np.count_nonzero((predicted == i) & (truth == i)) / union) if union else None)
    return {"reference": "Previous hand-fitted browser baseline; roof sections merged; not independent ground truth",
            "mapping_indices": "even original SOG indices passing the opacity filter",
            "scoring_indices": "odd original SOG indices passing the opacity filter",
            "reference_counts": dict(zip(NAMES, np.bincount(truth, minlength=8).tolist())),
            "part_point_iou": dict(zip(NAMES, ious)),
            "mean_point_iou": float(np.mean([v for v in ious if v is not None])),
            "assignment_agreement": float(np.mean(predicted == truth)),
            "mapping": [NAMES[i] if i >= 0 else None for i in mapping]}


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comparison", type=Path, default=root / "outputs/route-c-comparison/results.json")
    parser.add_argument("--sog", type=Path, default=root / "web/public/models/brandenburg-spirula.sog")
    parser.add_argument("--out", type=Path, default=root / "outputs/route-c-gate")
    parser.add_argument("--opacity", type=float, default=.02)
    parser.add_argument("--seed", type=int, help="Defaults to the synthetic comparison's training seed")
    parser.add_argument("--ems-checkout", type=Path, default=DEFAULT_CHECKOUT)
    args = parser.parse_args()
    if not 0 <= args.opacity <= 1:
        raise ValueError("Opacity threshold must be in [0,1]")
    comparison = json.loads(args.comparison.read_text())
    settings = comparison["settings"]
    seed = comparison["train_seed"] if args.seed is None else args.seed
    method = comparison["best_method"]
    if method not in ("pca", "ems"):
        raise ValueError("No successful synthetic method available")
    sha = hashlib.sha256(args.sog.read_bytes()).hexdigest()
    if sha != GATE_SHA256:
        raise ValueError("The coarse reference belongs to a different SOG; do not score this asset against it")
    started = time.perf_counter()
    args.out.mkdir(parents=True, exist_ok=True)
    viewer, opacity, _ = decode(args.sog)
    keep = opacity >= args.opacity
    if keep.sum() < settings["k"] or settings["k"] > np.iinfo(np.int16).max:
        raise ValueError("Not enough points pass the opacity threshold")
    fitted_points = viewer[keep]
    low, high = fitted_points.min(axis=0), fitted_points.max(axis=0)
    scale = 1.4 / (high[2] - low[2])
    axes = np.array([[1., 0, 0], [0, 0, 1.], [0, -1., 0]])
    origin = np.array([(low[0] + high[0]) / 2, fitted_points[:, 1].mean(), low[2]])
    shift = np.array([0., -.9, 0.])
    dbw = (viewer - origin) @ axes.T * scale + shift
    viewer_to_dbw = np.eye(4)
    viewer_to_dbw[:3, :3] = axes * scale
    viewer_to_dbw[:3, 3] = shift - axes @ origin * scale
    train = args.out / "gate-filtered.npy"
    np.save(train, dbw[keep])
    output = args.out / "primitives.json"
    wall = time.perf_counter()
    command = [sys.executable, str(Path(__file__).with_name("fit_primitives_3d.py")), str(train),
               "--method", method, "--output", str(output), "--k", str(settings["k"]), "--max-points", str(settings["max_points"]), "--seed", str(seed),
               "--ems-checkout", str(args.ems_checkout), "--max-seconds", str(settings["timeout_seconds"])]
    run = subprocess.run(command, timeout=settings["timeout_seconds"], capture_output=True, text=True,
                         env={**os.environ, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "NUMBA_NUM_THREADS": "1"})
    (args.out / "fit.log").write_text(run.stdout + run.stderr)
    run.check_returncode()
    fit_seconds = time.perf_counter() - wall
    data = json.loads(output.read_text())
    primitives = data["primitives"]
    assignments = np.empty(len(viewer), dtype=np.int16)
    inside_count = 0
    with threadpool_limits(limits=1):
        for start in range(0, len(dbw), 65536):
            chunk = dbw[start:start + 65536]
            assigned = assign_points(chunk, primitives)
            assignments[start:start + len(chunk)] = assigned
            for i, primitive in enumerate(primitives):
                inside_count += int(np.count_nonzero(log_implicit_values(chunk[assigned == i], primitive) < 0))
    np.save(args.out / "part_id.npy", assignments)
    spec = json.loads(Path(__file__).with_name("gate-browser-parts.json").read_text())
    reference = reference_assign(viewer, spec)
    reference = np.where(reference == 12, 7, np.where(reference >= 6, 6, reference))
    metrics = comparison_metrics(assignments, reference, keep, len(primitives))
    viewer_primitives = []
    for p in primitives:
        viewer_primitives.append({**p,
            "center": (((np.array(p["center"]) - shift) / scale) @ axes + origin).tolist(),
            "half_size": (np.array(p["half_size"]) / scale).tolist(),
            "rotation": (axes.T @ np.array(p["rotation"])).tolist()})
    (args.out / "primitives-viewer.json").write_text(json.dumps({"frame": "viewer-z-up", "source": str(args.sog), "primitives": viewer_primitives}, indent=2) + "\n")
    metadata = {"source_sha256": sha, "method": method, "selection_rule": comparison["selection_rule"],
                "source_sog_count": len(viewer), "fitting_opacity_threshold": args.opacity,
                "points_above_threshold": int(keep.sum()), "fit_points": data["fit"]["fit_points"],
                "primitive_count": len(primitives), "seed": seed,
                "part_id": {"file": "part_id.npy", "dtype": "int16", "ordering": "original SOG texel index",
                            "policy": "all source splats assigned by minimum implicit F, even outside solids; opacity threshold applies only to fitting"},
                "fraction_of_all_splats_inside_assigned_solid": inside_count / len(viewer),
                "source_to_viewer": np.diag([1, -1, -1, 1]).tolist(), "viewer_to_dbw": viewer_to_dbw.tolist(),
                "units": "DBW height normalized to 1.4 using opacity-filtered center bounds; not physical meters",
                "reference_comparison": metrics, "fit_wall_seconds": fit_seconds,
                "total_seconds_before_plot": time.perf_counter() - started,
                "machine": platform.platform(), "python": platform.python_version(), "fit_versions": data["fit"]["versions"]}
    (args.out / "metadata.json").write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n")
    rng = np.random.default_rng(seed)
    ids = np.flatnonzero(keep)
    ids = rng.choice(ids, min(18000, len(ids)), replace=False)
    bounds_low, bounds_high = dbw[keep].min(axis=0), dbw[keep].max(axis=0)
    for p in primitives:
        extent = abs(np.array(p["rotation"])) @ p["half_size"]
        bounds_low = np.minimum(bounds_low, p["center"] - extent)
        bounds_high = np.maximum(bounds_high, p["center"] + extent)
    fig = plt.figure(figsize=(12, 9))
    for row, (elev, azim) in enumerate(((0, -90), (25, -55))):
        for col in range(2):
            ax = fig.add_subplot(2, 2, row * 2 + col + 1, projection="3d")
            if col == 0:
                ax.scatter(dbw[ids, 0], -dbw[ids, 2], dbw[ids, 1], c=[plt.get_cmap("tab10")(i) for i in reference[ids]], s=.5)
            else:
                draw_solids(ax, primitives, metrics["mapping"], NAMES)
            ax.set_title("Coarse browser reference (points)" if col == 0 else f"Automatic {method.upper()} ({len(primitives)} solids)")
            ax.view_init(elev=elev, azim=azim)
            ax.set(xlim=(bounds_low[0], bounds_high[0]), ylim=(-bounds_high[2], -bounds_low[2]), zlim=(bounds_low[1], bounds_high[1]))
            if row == 0:
                ax.set_proj_type("ortho")
                ax.set_yticks([])
            ax.set_box_aspect((bounds_high - bounds_low)[[0, 2, 1]])
    fig.tight_layout()
    fig.savefig(args.out / "gate-comparison.jpg", dpi=140)
    plt.close(fig)
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()

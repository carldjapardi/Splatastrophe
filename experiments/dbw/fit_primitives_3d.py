"""CPU-only point-cloud fitting: k-means/PCA boxes or official hierarchical EMS.

Fitting receives coordinates only, never synthetic part labels. Both output the
shared superquadric convention: e1 belongs to local z, e2 to the local x/y plane;
rotation maps local column vectors into the caller's coordinate frame.
"""

import argparse
import hashlib
import importlib.metadata
import json
import platform
import subprocess
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np
from sklearn.cluster import DBSCAN, KMeans
from threadpoolctl import threadpool_limits

from prepare_ems import DEFAULT_CHECKOUT, EMS_COMMIT


def pca_box(points, minimum_half_size):
    mean = points.mean(axis=0)
    _, rotation = np.linalg.eigh(np.cov(points - mean, rowvar=False))
    rotation = rotation[:, ::-1]
    if np.linalg.det(rotation) < 0:
        rotation[:, -1] *= -1
    local = (points - mean) @ rotation
    lower, upper = local.min(axis=0), local.max(axis=0)
    return {
        "center": (mean + rotation @ ((lower + upper) / 2)).tolist(),
        "half_size": np.maximum((upper - lower) / 2, minimum_half_size).tolist(),
        "rotation": rotation.tolist(), "eps": [0.1, 0.1], "opacity": None,
    }


def load_ems(checkout):
    checkout = Path(checkout).resolve()
    actual = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    if actual != EMS_COMMIT:
        raise ValueError(f"EMS version mismatch: {actual}; run prepare_ems.py")
    patch = Path(__file__).with_name("ems-headless.patch")
    subprocess.run(["git", "-C", str(checkout), "apply", "--reverse", "--check", str(patch)], check=True)
    sys.path.insert(0, str(checkout / "Python/src"))
    from EMS.EMS_recovery import EMS_recovery
    return EMS_recovery


def fit_primitives(points, method="pca", *, k=32, seed=38, max_points=12000,
                   minimum_half_size=0.0025, ems_checkout=DEFAULT_CHECKOUT,
                   max_layers=5, cluster_eps=0.04, min_samples=12,
                   min_component=60, max_seconds=840):
    started = time.perf_counter()
    points = np.asarray(points, dtype=float)
    if points.ndim != 2 or points.shape[1] != 3 or len(points) < 4 or not np.isfinite(points).all():
        raise ValueError("Expected at least four finite 3D points")
    if method not in ("pca", "ems"):
        raise ValueError("method must be pca or ems")
    if k < 1 or max_points < max(4, k) or k > len(points):
        raise ValueError("Invalid primitive budget or maximum point count")
    if minimum_half_size <= 0 or cluster_eps <= 0 or min_samples < 1 or min_component < 4 or max_layers < 1 or max_seconds <= 0:
        raise ValueError("Fitting settings must be positive and components need at least four points")
    rng = np.random.default_rng(seed)
    input_count = len(points)
    if len(points) > max_points:
        points = points[np.sort(rng.choice(len(points), max_points, replace=False))]
    origin = points.mean(axis=0)
    scale = np.ptp(points, axis=0).max()
    if scale <= 1e-12:
        raise ValueError("Point cloud has zero extent")
    normalized = (points - origin) / scale
    primitives, diagnostics = [], []
    settings = dict(method=method, k=k, seed=seed, max_points=max_points,
                    minimum_half_size=minimum_half_size, max_layers=max_layers,
                    cluster_eps=cluster_eps, min_samples=min_samples,
                    min_component=min_component, max_seconds=max_seconds)
    ems_settings = dict(OutlierRatio=0.9, MaxIterationEM=20, ToleranceEM=1e-3,
                        RelativeToleranceEM=0.1, MaxOptiIterations=3, Sigma=0,
                        MaxiSwitch=2, AdaptiveUpperBound=False, Rescale=True)
    pending = deque()
    budget_exhausted = False
    with threadpool_limits(limits=1):
        if method == "pca":
            labels = KMeans(n_clusters=k, random_state=seed, n_init=5, max_iter=100).fit_predict(normalized)
            for label in range(k):
                cluster = normalized[labels == label]
                if len(cluster) < 4:
                    diagnostics.append({"cluster": label, "status": "skipped", "reason": "fewer than four points"})
                    continue
                primitives.append(pca_box(cluster, minimum_half_size))
        else:
            recovery = load_ems(ems_checkout)
            pending.append((normalized, 0))
            while pending and len(primitives) < k:
                if time.perf_counter() - started >= max_seconds:
                    budget_exhausted = True
                    break
                cluster, layer = pending.popleft()
                if len(cluster) < min_component:
                    diagnostics.append({"layer": layer, "points": len(cluster), "status": "skipped", "reason": "below minimum component size"})
                    continue
                if np.linalg.matrix_rank(cluster - cluster.mean(axis=0), tol=1e-8) < 3:
                    diagnostics.append({"layer": layer, "points": len(cluster), "status": "failed", "reason": "rank-deficient cloud; no unobserved thickness invented for EMS"})
                    continue
                try:
                    with np.errstate(over="raise", invalid="raise", divide="raise"):
                        sq, posterior = recovery(cluster, **ems_settings)
                    if not all(np.isfinite(v).all() for v in (sq.shape, sq.scale, sq.translation, sq.RotM, posterior)) or np.any(sq.scale <= 0) or np.any(sq.shape <= 0):
                        raise ValueError("EMS produced non-finite or non-positive parameters")
                except (ValueError, FloatingPointError, ZeroDivisionError, np.linalg.LinAlgError) as exc:
                    diagnostics.append({"layer": layer, "points": len(cluster), "status": "failed", "reason": str(exc)})
                    continue
                primitives.append({"center": sq.translation.tolist(), "half_size": sq.scale.tolist(),
                                   "rotation": sq.RotM.tolist(), "eps": sq.shape.tolist(), "opacity": None})
                outliers = cluster[posterior < 0.1]
                diagnostics.append({"layer": layer, "points": len(cluster), "outliers": len(outliers), "status": "fitted"})
                if layer + 1 >= max_layers or posterior.sum() >= 0.8 * len(cluster) or len(outliers) < min_component:
                    continue
                labels = DBSCAN(eps=cluster_eps, min_samples=min_samples, n_jobs=1).fit_predict(outliers)
                for label in sorted(set(labels) - {-1}):
                    pending.append((outliers[labels == label], layer + 1))
                diagnostics.append({"layer": layer, "status": "residual-clustering", "noise_points": int(np.sum(labels == -1))})
    for i, primitive in enumerate(primitives):
        primitive["id"] = i
        primitive["center"] = (np.asarray(primitive["center"]) * scale + origin).tolist()
        primitive["half_size"] = (np.asarray(primitive["half_size"]) * scale).tolist()
    report = {
        "settings": settings, "input_points": input_count, "fit_points": len(points),
        "fit_points_sha256": hashlib.sha256(points.astype("<f8").tobytes()).hexdigest(),
        "normalization": {"center": origin.tolist(), "max_span": float(scale)},
        "runtime_seconds": time.perf_counter() - started,
        "budget_exhausted": budget_exhausted,
        "remaining_components_at_primitive_cap": len(pending), "diagnostics": diagnostics,
        "machine": platform.platform(), "python": platform.python_version(),
        "versions": {name: importlib.metadata.version(name) for name in ("numpy", "scipy", "numba", "scikit-learn", "threadpoolctl")},
    }
    if method == "ems":
        diff = subprocess.check_output(["git", "-C", str(ems_checkout), "diff"])
        report["ems"] = {"commit": EMS_COMMIT, "compatibility_diff_sha256": hashlib.sha256(diff).hexdigest(),
                         "parameters": ems_settings, "hierarchy_source": "Python/tests/multiquadric_test.py",
                         "adaptations": "headless, normalized DBSCAN radius, size/depth/count/time caps, explicit failure diagnostics"}
    return primitives, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("points", type=Path, help=".npy Nx3 or .npz with points key")
    parser.add_argument("--method", choices=["pca", "ems"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frame", default="dbw")
    parser.add_argument("--k", type=int, default=32)
    parser.add_argument("--seed", type=int, default=38)
    parser.add_argument("--max-points", type=int, default=12000)
    parser.add_argument("--ems-checkout", type=Path, default=DEFAULT_CHECKOUT)
    parser.add_argument("--max-seconds", type=float, default=840)
    args = parser.parse_args()
    data = np.load(args.points, allow_pickle=False)
    points = data["points"] if isinstance(data, np.lib.npyio.NpzFile) else data
    primitives, report = fit_primitives(points, args.method, k=args.k, seed=args.seed,
        max_points=args.max_points, ems_checkout=args.ems_checkout, max_seconds=args.max_seconds)
    result = {"frame": args.frame, "source": str(args.points), "primitives": primitives, "fit": report}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"method": args.method, "primitives": len(primitives), "runtime_seconds": report["runtime_seconds"],
                      "failed_components": sum(d["status"] == "failed" for d in report["diagnostics"])}))
    if not primitives or report["budget_exhausted"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()

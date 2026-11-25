"""NumPy-only Phase-1 geometric evaluation in the DBW coordinate frame.

The standard polar superquadric convention puts e1 on local z and e2 in
the local xy plane. Rotation is world-from-local, so row points use (p-c)@R.
This is an interchange convention, not a claim about an unconverted DBW export.
Voxel overlap ties go to the first authored block; primitive majority ties go
to the first PART_NAMES entry. Each predicted part is the independent union of
all primitives mapped to it, so different predicted parts may overlap. Background
never wins a semantic majority, but all predicted
volume (including primitives with no true overlap) counts against volume IoU.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np

import faults_geometry


PART_NAMES = ("base", "left wall", "right wall", "centre pier", "lintel",
              "attic", "cornice", "top")
MAX_VOXELS = 20_000_000
CHUNK_SIZE = 65536


def _blocks():
    return faults_geometry.to_dbw(faults_geometry.authored_blocks())[0]


def _validate(primitives):
    if not isinstance(primitives, list):
        raise ValueError("primitives must be a list")
    ids = set()
    for p in primitives:
        if not isinstance(p, dict):
            raise ValueError("each primitive must be an object")
        if type(p.get("id")) is not int or p["id"] in ids:
            raise ValueError("primitive ids must be unique integers")
        ids.add(p["id"])
        for key, shape in (("center", (3,)), ("half_size", (3,)),
                           ("rotation", (3, 3)), ("eps", (2,))):
            try:
                a = np.asarray(p[key], dtype=float)
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"invalid primitive {key}") from exc
            if a.shape != shape or not np.isfinite(a).all():
                raise ValueError(f"invalid primitive {key}")
            if key in ("half_size", "eps") and np.any(a <= 0):
                raise ValueError(f"{key} must be positive")
        r = np.asarray(p["rotation"], dtype=float)
        if not np.allclose(r.T @ r, np.eye(3), atol=1e-6) or not np.isclose(np.linalg.det(r), 1, atol=1e-6):
            raise ValueError("rotation must be a proper orthonormal world-from-local matrix")
        if "opacity" not in p:
            raise ValueError("opacity is required (null is allowed)")
        opacity = p["opacity"]
        if opacity is not None and (not isinstance(opacity, (int, float)) or not math.isfinite(opacity) or not 0 <= opacity <= 1):
            raise ValueError("opacity must be null or a finite number in [0, 1]")
    return primitives


def load_primitives(path):
    """Load and validate interchange JSON; do not silently prune by opacity."""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or data.get("frame") != "dbw" or not isinstance(data.get("source"), str):
        raise ValueError("expected frame='dbw' and a source string")
    return _validate(data.get("primitives"))


def _points(points):
    points = np.asarray(points, dtype=float)
    if points.ndim != 2 or points.shape[1] != 3 or not np.isfinite(points).all():
        raise ValueError("points must be a finite (N, 3) array")
    return points


def log_implicit_values(points, primitive):
    """Stable log(F), including -inf at the center; local z carries e1.

    Unlike direct powers, the log domain preserves ordering far outside a small
    box. implicit_values may legitimately return +inf when F exceeds float64.
    """
    local = (_points(points) - np.asarray(primitive["center"])) @ np.asarray(primitive["rotation"])
    e1, e2 = primitive["eps"]
    with np.errstate(divide="ignore"):
        logs = np.log(np.abs(local)) - np.log(primitive["half_size"])
    xy = np.logaddexp(logs[:, 0] * (2 / e2), logs[:, 1] * (2 / e2))
    return np.logaddexp(xy * (e2 / e1), logs[:, 2] * (2 / e1))


def implicit_values(points, primitive):
    with np.errstate(over="ignore"):
        return np.exp(log_implicit_values(points, primitive))


def assign_points(points, primitives):
    """Return primitive list indices, not ids; ties favor the first primitive."""
    points = _points(points)
    _validate(primitives)
    assigned = np.full(len(points), -1, dtype=np.int64)
    best = np.full(len(points), np.inf)
    for i, primitive in enumerate(primitives):
        values = log_implicit_values(points, primitive)
        better = (values < best) | (assigned < 0)
        assigned[better] = i
        best[better] = values[better]
    return assigned


def true_primitives():
    """52 rounded-box primitives; eps=.1 cuts a small volume off box corners."""
    return [{"id": i, "center": p["centre"],
             "half_size": (np.asarray(p["size"]) / 2).tolist(),
             "rotation": np.eye(3).tolist(), "eps": [0.1, 0.1], "opacity": 1.0}
            for i, p in enumerate(_blocks())]


def front_cameras():
    """21 perspective cameras: 7 azimuths [-60,60], 3 elevations [0,30]."""
    target = np.array([0.0, -0.2, 0.0])
    return np.array([target + 4 * np.array([np.sin(a) * np.cos(e), np.sin(e), np.cos(a) * np.cos(e)])
                     for a in np.deg2rad(np.linspace(-60, 60, 7))
                     for e in np.deg2rad([0, 15, 30])])


def visible_from_cameras(points, cameras, blocks=None):
    """Analytic segment/slab test against opaque boxes, including the own box.

    Only positive-length intersections strictly before the sampled endpoint
    occlude. Ignoring the whole incident box would incorrectly expose rear faces.
    The 1e-6 world-unit endpoint tolerance absorbs float32 surface rounding.
    """
    points = _points(points)
    cameras = _points(cameras)
    blocks = _blocks() if blocks is None else blocks
    visible = np.zeros(len(points), dtype=bool)
    for camera in cameras:
        indices = np.flatnonzero(~visible)
        if not len(indices):
            break
        directions = points[indices] - camera
        distance = np.linalg.norm(directions, axis=1)
        if np.any(distance == 0):
            raise ValueError("camera must not coincide with a sample")
        tolerance = 1e-6 / distance
        occluded = np.zeros(len(indices), dtype=bool)
        for block in blocks:
            center, half = np.asarray(block["centre"]), np.asarray(block["size"]) / 2
            low, high = center - half, center + half
            parallel = np.abs(directions) < 1e-15
            with np.errstate(divide="ignore", invalid="ignore"):
                t0, t1 = (low - camera) / directions, (high - camera) / directions
            near = np.where(parallel, -np.inf, np.minimum(t0, t1)).max(axis=1)
            far = np.where(parallel, np.inf, np.maximum(t0, t1)).min(axis=1)
            outside = np.any(parallel & ((camera < low) | (camera > high)), axis=1)
            occluded |= (~outside) & (np.minimum(far, 1 - tolerance) - np.maximum(near, 0) > tolerance)
        visible[indices[~occluded]] = True
    return visible


def synthetic_points(variant="full", n=12000, seed=38):
    """Sample n points once; shell filters them and therefore returns fewer.

    Labels retain the generating block even at interpenetrating surfaces. They
    are evaluation-only; fitters must receive only the points array.
    """
    if variant not in ("full", "shell") or not isinstance(n, int) or n < 0:
        raise ValueError("expected full/shell and a nonnegative integer point count")
    if n == 0:
        return np.empty((0, 3)), np.empty(0, dtype=np.int64)
    points, indices = faults_geometry.surface_points(_blocks(), n, np.random.default_rng(seed), return_index=True)
    if variant == "shell":
        keep = visible_from_cameras(points, front_cameras())
        points, indices = points[keep], indices[keep]
    return points, indices


def voxelize(points, blocks=None):
    """Label voxel centers: first authored containing block wins overlaps.

    Return block_index, part_index (-1 outside), and fault (None outside or for
    unfaulted base). An outside voxel is distinguished by block_index == -1.
    """
    points = _points(points)
    blocks = _blocks() if blocks is None else blocks
    block_index = np.full(len(points), -1, dtype=np.int64)
    part_index = np.full(len(points), -1, dtype=np.int64)
    fault = np.full(len(points), None, dtype=object)
    for i, block in enumerate(blocks):
        inside = (block_index < 0) & np.all(np.abs(points - block["centre"]) <= np.asarray(block["size"]) / 2, axis=1)
        block_index[inside] = i
        part_index[inside] = PART_NAMES.index(block["part"])
        fault[inside] = block["fault"]
    return {"block_index": block_index, "part_index": part_index, "fault": fault}


def _grid(primitives, resolution):
    if type(resolution) is not int or resolution < 1:
        raise ValueError("resolution must be a positive integer")
    boxes = _blocks()
    centers = np.array([p["centre"] for p in boxes])
    halves = np.array([p["size"] for p in boxes]) / 2
    truth_low, truth_high = (centers - halves).min(0), (centers + halves).max(0)
    low, high = truth_low.copy(), truth_high.copy()
    for p in primitives:
        extent = np.abs(np.asarray(p["rotation"])) @ np.asarray(p["half_size"])
        low = np.minimum(low, np.asarray(p["center"]) - extent)
        high = np.maximum(high, np.asarray(p["center"]) + extent)
    step = (truth_high[1] - truth_low[1]) / resolution
    with np.errstate(over="ignore", invalid="ignore"):
        lower = np.floor((low - truth_low) / step)
        upper = np.ceil((high - truth_low) / step)
    if not np.isfinite(lower).all() or not np.isfinite(upper).all():
        raise ValueError("predicted bounds are too large for a finite voxel domain")
    shape = tuple(int(hi) - int(lo) for lo, hi in zip(lower, upper))
    count = math.prod(shape)
    if count > MAX_VOXELS:
        raise ValueError(f"voxel domain requires {count} voxels, limit {MAX_VOXELS}; lower resolution explicitly")
    return truth_low + lower * step, step, shape, count


def _chunks(origin, step, shape, count):
    for start in range(0, count, CHUNK_SIZE):
        indices = np.arange(start, min(start + CHUNK_SIZE, count))
        yield origin + (np.array(np.unravel_index(indices, shape)).T + 0.5) * step


def _occupancy(points, primitive):
    extent = np.abs(np.asarray(primitive["rotation"])) @ np.asarray(primitive["half_size"])
    mask = np.all(np.abs(points - primitive["center"]) <= extent, axis=1)
    mask[mask] = log_implicit_values(points[mask], primitive) < 0
    return mask


def evaluate(primitives, points=None, block_indices=None, resolution=128):
    """Score predicted solids on a shared, truth-anchored, chunked voxel grid.

    Grid spacing is true building height/resolution. Bounds cover all predicted
    OBBs as well as truth, so disjoint hallucinated solids are never clipped.
    Mapping uses overlap counts only; unoverlapping primitives map to None.
    """
    _validate(primitives)
    if (points is None) != (block_indices is None):
        raise ValueError("points and block_indices must be supplied together")
    if points is None:
        points, block_indices = synthetic_points()
    points = _points(points)
    block_indices = np.asarray(block_indices)
    if block_indices.shape != (len(points),) or block_indices.dtype.kind not in "iu" or np.any((block_indices < 0) | (block_indices >= 52)):
        raise ValueError("block_indices must be integer generating-block indices in [0,52)")
    origin, step, shape, count = _grid(primitives, resolution)
    overlap = np.zeros((len(primitives), 8), dtype=np.int64)
    truth_counts = np.zeros(8, dtype=np.int64)
    volume_intersection = volume_union = 0
    for chunk in _chunks(origin, step, shape, count):
        truth = voxelize(chunk)["part_index"]
        truth_counts += np.bincount(truth[truth >= 0], minlength=8)
        union = np.zeros(len(chunk), dtype=bool)
        for i, p in enumerate(primitives):
            inside = _occupancy(chunk, p)
            union |= inside
            labels = truth[inside & (truth >= 0)]
            overlap[i] += np.bincount(labels, minlength=8)
        volume_intersection += int(np.count_nonzero(union & (truth >= 0)))
        volume_union += int(np.count_nonzero(union | (truth >= 0)))
    mapping = np.where(overlap.sum(axis=1) > 0, overlap.argmax(axis=1), -1) if primitives else np.empty(0, dtype=int)
    predicted_counts = np.zeros(8, dtype=np.int64)
    intersections = np.zeros(8, dtype=np.int64)
    for chunk in _chunks(origin, step, shape, count):
        truth = voxelize(chunk)["part_index"]
        predicted = np.zeros((8, len(chunk)), dtype=bool)
        for p, label in zip(primitives, mapping):
            if label >= 0:
                predicted[label] |= _occupancy(chunk, p)
        predicted_counts += predicted.sum(axis=1)
        intersections += np.array([np.count_nonzero(predicted[i] & (truth == i)) for i in range(8)])
    unions = truth_counts + predicted_counts - intersections
    ious = np.divide(intersections, unions, out=np.zeros(8, dtype=float), where=unions > 0)
    assignment = assign_points(points, primitives)
    predicted_parts = np.full(len(points), -1, dtype=int)
    if primitives:
        predicted_parts = mapping[assignment]
    true_parts = np.array([PART_NAMES.index(p["part"]) for p in _blocks()])[block_indices]
    return {"part_iou": dict(zip(PART_NAMES, ious.tolist())),
            "mean_part_iou": float(ious.mean()), "parts_over_0_5": int(np.count_nonzero(ious > 0.5)),
            "volume_iou": volume_intersection / volume_union if volume_union else 0.0,
            "point_assignment_accuracy": float(np.mean(predicted_parts == true_parts)) if len(points) else None,
            "primitive_count": len(primitives), "mapping": [PART_NAMES[i] if i >= 0 else None for i in mapping],
            "point_count": len(points), "voxel_count": count, "voxel_size": float(step),
            "voxel_shape": list(shape), "voxel_origin": origin.tolist(), "resolution": resolution,
            "truth_overlap_policy": "first authored block", "prediction_overlap_policy": "independent union per mapped part",
            "primitive_majority_policy": "true occupied voxels only; ties use part order"}


def self_test(resolution=128):
    """Check rounded boxes against exact-box overlap expectations on this grid.

    Acceptance is calibrated at resolution 128; coarser grids are diagnostic
    and may fail because thin rounded solids alias differently. Exact boxes
    themselves cannot attain unit part IoU where different parts overlap:
    their predicted unions overlap, but first-authored truth labels do not.
    """
    points, indices = synthetic_points()
    primitives = true_primitives()
    result = evaluate(primitives, points, indices, resolution)
    truth_counts = np.zeros(8, dtype=np.int64)
    exact_counts = np.zeros(8, dtype=np.int64)
    for chunk in _chunks(*_grid(primitives, resolution)):
        truth = voxelize(chunk)["part_index"]
        truth_counts += np.bincount(truth[truth >= 0], minlength=8)
        exact = np.zeros((8, len(chunk)), dtype=bool)
        for block in _blocks():
            exact[PART_NAMES.index(block["part"])] |= np.all(np.abs(chunk - block["centre"]) <= np.asarray(block["size"]) / 2, axis=1)
        exact_counts += exact.sum(axis=1)
    exact_iou = np.divide(truth_counts, exact_counts, out=np.zeros(8, dtype=float), where=exact_counts > 0)
    errors = np.abs(np.array(list(result["part_iou"].values())) - exact_iou)
    result["exact_box_part_iou"] = dict(zip(PART_NAMES, exact_iou.tolist()))
    result["part_iou_absolute_error_from_exact_boxes"] = dict(zip(PART_NAMES, errors.tolist()))
    result["cross_part_overlap_voxels"] = dict(zip(PART_NAMES, (exact_counts - truth_counts).tolist()))
    result["self_test_thresholds"] = {"part_iou_absolute_error": 0.035, "mean_part_iou": 0.95,
                                      "volume_iou": 0.95, "point_assignment_accuracy": 0.95}
    result["self_test_note"] = ("eps=.1 rounds box corners; predicted parts are independent unions whereas true voxel labels are exclusive. "
                                "Cross-part box overlaps therefore reduce even true-box part IoU. Full sampling includes interpenetrating surfaces. "
                                "Argmin F can select a different containing block there; generating-block labels are unchanged.")
    parts = np.array([PART_NAMES.index(p["part"]) for p in _blocks()])
    assignments = assign_points(points, primitives)
    mismatch = parts[assignments] != parts[indices]
    other_part_containment = np.zeros(len(points), dtype=bool)
    for i, block in enumerate(_blocks()):
        inside = np.all(np.abs(points - block["centre"]) < np.asarray(block["size"]) / 2 - 1e-7, axis=1)
        other_part_containment |= inside & (parts[indices] != parts[i])
    result["surface_cross_part_interior_fraction"] = float(other_part_containment.mean())
    result["assignment_errors_in_cross_part_interiors"] = int(np.count_nonzero(mismatch & other_part_containment))
    result["assignment_error_count"] = int(mismatch.sum())
    if np.any(errors > 0.035) or result["mean_part_iou"] < 0.95 or result["volume_iou"] < 0.95 or result["point_assignment_accuracy"] < 0.95:
        raise AssertionError(f"ground-truth self-test outside exact-box tolerance: {json.dumps(result)}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-test", action="store_true")
    mode.add_argument("--primitives", type=Path)
    mode.add_argument("--generate-points", type=Path, metavar="NPZ")
    parser.add_argument("--variant", choices=("full", "shell"), default="full")
    parser.add_argument("--points", type=int, default=12000)
    parser.add_argument("--seed", type=int, default=38)
    parser.add_argument("--resolution", type=int, default=128)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.self_test:
        result = self_test(args.resolution)
    else:
        points, indices = synthetic_points(args.variant, args.points, args.seed)
        if args.generate_points:
            args.generate_points.parent.mkdir(parents=True, exist_ok=True)
            with args.generate_points.open("wb") as handle:
                np.savez_compressed(handle, points=points, block_index=indices)
            result = {"path": str(args.generate_points), "point_count": len(points)}
        else:
            result = evaluate(load_primitives(args.primitives), points, indices, args.resolution)
        result.update(variant=args.variant, requested_point_count=args.points, seed=args.seed)
    text = json.dumps(result, indent=2, allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()

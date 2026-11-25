"""Export the browser prototype's stable SOG-index membership, not a learned fit.

Requires numpy and Pillow. SOG v3 is decoded in original texture-index order.
Viewer coordinates are source coordinates multiplied by diag(1, -1, -1).
"""

import argparse
import hashlib
import io
import json
import platform
import time
import zipfile
from pathlib import Path

import numpy as np
import PIL
from PIL import Image


def decode(path):
    with zipfile.ZipFile(path) as archive:
        meta = json.loads(archive.read("meta.json"))
        if meta["version"] != 3:
            raise ValueError("This export supports the checked-in SOG v3 asset only")
        count = meta["count"]

        def image(name):
            with Image.open(io.BytesIO(archive.read(name))) as im:
                return np.asarray(im.convert("RGBA")).reshape(-1, 4)[:count]

        lo, hi = (image(name)[:, :3] for name in meta["means"]["files"])
        v = np.asarray(meta["means"]["mins"]) + (hi.astype(float) * 256 + lo) / 65535 * (
            np.asarray(meta["means"]["maxs"]) - meta["means"]["mins"])
        points = np.sign(v) * np.expm1(abs(v))
        points[:, 1:] *= -1
        color = image(meta["sh0"]["files"][0])
        opacity = (color[:, 3].astype(float) / 204) ** 2
        scales = np.exp(np.asarray(meta["scales"]["codebook"])[image(meta["scales"]["files"][0])[:, :3]])
        return points, opacity, scales


def assign(points, spec):
    ids = np.argmin(abs(points[:, 0, None] - spec["columnX"]), axis=1).astype(np.int16)
    roof = points[:, 2] >= spec["columnTop"]
    ids[roof] = 6 + np.clip(np.searchsorted(spec["roofEdges"][1:], points[roof, 0], side="right"), 0, 5)
    sculpture = (points[:, 2] >= spec["roofTop"]) & (points[:, 0] >= spec["sculptureBounds"][0][0]) & (points[:, 0] <= spec["sculptureBounds"][1][0])
    ids[sculpture] = 12
    outside = np.any((points < spec["assignmentBounds"][0]) | (points > spec["assignmentBounds"][1]), axis=1)
    ids[outside | ~np.isfinite(points).all(axis=1)] = -1
    return ids


def boxes(spec):
    parts = []

    def add(name, lower, upper):
        lower, upper = np.array(lower), np.array(upper)
        parts.append({"id": len(parts), "name": name, "center": ((lower + upper) / 2).tolist(),
                      "half_size": ((upper - lower) / 2).tolist(), "rotation": np.eye(3).tolist(),
                      "eps": [0.1, 0.1], "opacity": None})

    for i, x in enumerate(spec["columnX"]):
        add(f"column-{i + 1}", [x - spec["columnHalfWidth"], spec["columnDepth"][0], spec["groundZ"]],
            [x + spec["columnHalfWidth"], spec["columnDepth"][1], spec["columnTop"]])
    for i, (a, b) in enumerate(zip(spec["roofEdges"][:-1], spec["roofEdges"][1:])):
        add(f"roof-{i + 1}", [a, spec["roofDepth"][0], spec["columnTop"]],
            [b, spec["roofDepth"][1], spec["roofTop"]])
    add("quadriga", *spec["sculptureBounds"])
    return parts


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sog", type=Path, default=root / "web/public/models/brandenburg-spirula.sog")
    parser.add_argument("--out", type=Path, default=root / "outputs/task2-browser")
    args = parser.parse_args()
    started = time.perf_counter()
    spec = json.loads(Path(__file__).with_name("gate-browser-parts.json").read_text())
    points, opacity, scales = decode(args.sog)
    ids = assign(points, spec)
    args.out.mkdir(parents=True, exist_ok=True)
    np.save(args.out / "part_id.npy", ids)
    np.savez_compressed(args.out / "gaussians.npz", centers=points, opacity=opacity, scales=scales)
    parts = boxes(spec)
    primitives = {"frame": "viewer-z-up", "source": spec["source"], "primitives": parts}
    (args.out / "primitives.json").write_text(json.dumps(primitives, indent=2) + "\n")
    contacts = []
    for i, a in enumerate(parts):
        ca, ha = np.array(a["center"]), np.array(a["half_size"])
        for b in parts[i + 1:]:
            cb, hb = np.array(b["center"]), np.array(b["half_size"])
            overlap = np.minimum(ca + ha, cb + hb) - np.maximum(ca - ha, cb - hb)
            for axis in range(3):
                other = [j for j in range(3) if j != axis]
                if abs(abs(ca[axis] - cb[axis]) - ha[axis] - hb[axis]) <= 1e-5 and np.all(overlap[other] > 0):
                    area = float(np.prod(overlap[other]))
                    contacts.append({"a": a["id"], "b": b["id"], "axis": axis,
                                     "area_viewer_units_squared": area,
                                     "area_illustrative_meters_squared": area * spec["metersPerUnit"] ** 2})
                    break
    (args.out / "contacts.json").write_text(json.dumps({"frame": "viewer-z-up", "contacts": contacts,
        "ground_anchors": [p["id"] for p in parts if abs(p["center"][2] - p["half_size"][2] - spec["groundZ"]) <= 1e-5]}, indent=2) + "\n")
    metadata = {
        "schemaVersion": 1, "source_sha256": hashlib.sha256(args.sog.read_bytes()).hexdigest(),
        "count": len(ids), "part_id_dtype": "int16", "background_id": -1,
        "ordering": "Original SOG texel/splat index; no filtering, sorting, or decimation",
        "reference": "Hand-fitted coarse proxy baseline; no independent manual reference available",
        "source_to_viewer": np.diag([1, -1, -1, 1]).tolist(),
        "settings": spec, "counts": {str(i): int(np.sum(ids == i)) for i in range(-1, 13)},
        "seed": None, "deterministic": True, "machine": platform.platform(),
        "python": platform.python_version(), "numpy": np.__version__, "pillow": PIL.__version__,
        "runtime_seconds": time.perf_counter() - started,
    }
    (args.out / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()

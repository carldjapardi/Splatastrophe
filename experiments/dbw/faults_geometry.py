"""Geometry of the fault-point collapse building (web/public/faults/collapse.js), NumPy only.

The block list is copied call for call from collapse.js: centre x, y, z and size dx, dy, dz in authored units, z up.
`to_dbw` moves it into the DBW frame used by synthetic_faults.py and the gate data: x right, y up, ground at y = -0.9,
1.4 units tall. Every block keeps its fault label (A/B/C or None) and its structural part
(base, left wall, right wall, centre pier, lintel, attic, cornice, top).
"""
import numpy as np


def authored_blocks():
    """Same calls and order as collapse.js. Returns (fault, part, centre xyz, size xyz), z up."""
    blocks = []

    def add(fault, part, x, y, z, dx, dy, dz):
        blocks.append((fault, part, (x, y, z), (dx, dy, dz)))

    add(None, 'base', 0, 0, .18, 7.28, 2.80, .36)
    add(None, 'base', 0, 0, .43, 6.95, 2.53, .14)
    for row in range(5):
        z = .78 + row * .54
        stagger = .045 if row % 2 else -.045
        add('A', 'left wall', -2.68 + stagger, -.03, z, .80, 1.74, .51)
        add('A', 'left wall', -1.83 + stagger, -.03, z, .87, 1.74, .51)
        add('C', 'right wall', 1.82 + stagger, .09, z, .87, 1.72, .51)
        add('C', 'right wall', 2.68 + stagger, .09, z, .80, 1.72, .51)
        if row < 4:
            add('B', 'centre pier', -.49, -.71, z, .90, .30, .51)
            add('B', 'centre pier', .49, -.71, z, .90, .30, .51)
    for index in range(-3, 4):
        fault = 'A' if index < -1 else 'C' if index > 1 else 'B'
        add(fault, 'lintel', index * .88, 0, 3.31, .85, 1.85, .51)
        add(fault, 'attic', index * .88, 0, 3.75, .87, 2.04, .34)
    for index in range(-2, 3):
        add('B', 'cornice', index * .80, 0, 4.05, .77, 1.65, .25)
    add('B', 'top', -.71, 0, 4.33, .80, 1.34, .28)
    add('B', 'top', .15, 0, 4.33, .86, 1.34, .28)
    add('B', 'top', .67, 0, 4.61, .57, .87, .25)
    return blocks


def to_dbw(blocks):
    """Authored (x, y, z up) -> DBW frame (x, y up, z = -authored y), scaled to 1.4 units tall, ground at y = -0.9."""
    top = max(c[2] + s[2] / 2 for _, _, c, s in blocks)
    scale = 1.4 / top
    out = []
    for fault, part, (x, y, z), (dx, dy, dz) in blocks:
        centre = np.array([x, z, -y]) * scale + np.array([0, -0.9, 0])
        size = np.array([dx, dz, dy]) * scale
        out.append({'fault': fault, 'part': part, 'centre': centre.tolist(), 'size': size.tolist()})
    return out, scale


def surface_points(parts, n=20000, rng=None, return_index=False):
    """Uniform samples on the block surfaces (area-weighted). With return_index, also the block index of each point.
    Faces shared by touching blocks are sampled too, so some points lie inside the building."""
    areas = []
    for p in parts:
        sx, sy, sz = p['size']
        areas.append(2 * (sx * sy + sy * sz + sx * sz))
    areas = np.array(areas) / sum(areas)
    pts = []
    idx = rng.choice(len(parts), n, p=areas)
    for k in idx:
        c, s = np.array(parts[k]['centre']), np.array(parts[k]['size'])
        u = rng.uniform(-0.5, 0.5, 3)
        axis = rng.integers(3)
        u[axis] = rng.choice([-0.5, 0.5])
        pts.append(c + u * s)
    pts = np.array(pts, dtype=np.float32)
    return (pts, idx) if return_index else pts

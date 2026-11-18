# Physics fixtures

Small authored scenes for the bend and impact prototypes. Do not put datasets, scans, checkpoints, or trained splats here.

## `synthetic-tower.json`

One procedural building and one shadow-casting directional light.

| | |
|---|---|
| Coordinates | right-handed, Y-up, meters, quaternions `[x, y, z, w]` |
| Provenance | authored geometry, no cameras, no reconstruction |
| Bend | tapered shell, anchored below `anchorHeight`, quadratic height weight |
| Impact | 2×2×6 block stack, same footprint and overall height, predefined joints |
| Light | one directional light, `castShadow: true` |

The impact stack is not a voxelization of the taper. Bend and impact stay separate modes; reset before switching.

Both controllers load this file. From `web/src/deformation`:

```bash
npm install
npm test
npm run dev
```

Limits of the motion are recorded in [web/src/deformation/LIMITATIONS.md](../../web/src/deformation/LIMITATIONS.md).

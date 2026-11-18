# Bend prototype

Procedural bending for the synthetic tower. No reconstruction, dataset, or checkpoint is required.

The controller is a reusable module. The Vite demo in this folder is a standalone harness so it does not depend on the app shell.

## Run

From this directory:

```bash
npm install
npm test
npm run dev
```

`npm install` links `web/src/impact/node_modules` at this package so the impact module resolves Rapier. `npm run dev` listens on `0.0.0.0` and `$PORT` when that variable is set, otherwise port 5173.

Bend and impact are separate modes. Switching modes resets both. Orbit with the pointer, zoom with the wheel, and use the strength and direction sliders. Keys: `B` bend, `I` impact, `R` reset.

The impact mode uses the controller in `web/src/impact/`. Both modes read `fixtures/physics/synthetic-tower.json`.

Query parameters for a repeatable view: `?bend=0.75&dir=25`, `?mode=impact&strike=1`.

## API

`createBendController({ tower, maxTipAngleRadians, responseSeconds })` returns:

- `setBend(strength, direction)` — `strength` is clamped to `[0, 1]`. `direction` is a world vector; Y is ignored and the XZ part is normalized. A purely vertical direction clears the bend.
- `update(dt)` — eases the current bend toward the target.
- `getField()` — sample the shared field. Meshes, the lighting proxy, and splats all use this.
- `reset()` — rest pose immediately.
- `dispose()` — further calls throw.

`field.sample(restPosition)` returns position, quaternion `[x, y, z, w]`, axial stretch, and whether the point is inside the anchored base.

Coordinates are right-handed, Y-up, meters.

## What the demo shows

One tapered tower and one shadow-casting directional light. The opaque-translucent shell is the visible geometry. A slightly larger shell is the lighting proxy: it uses the same field, and it is the shadow caster. Procedural Gaussians update center, rotation, and scale together. The HUD prints the tip quaternion and axial scale so a center-only update is obvious.

See [LIMITATIONS.md](LIMITATIONS.md).

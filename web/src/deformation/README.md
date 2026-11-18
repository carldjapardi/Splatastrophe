# Bend prototype

Procedural bending for the synthetic tower. No reconstruction, dataset, or checkpoint is required.

The controller is a reusable module. The Vite demo in this folder is a standalone harness so it does not depend on the app shell.

## Run

From the repository root (Node 22.12+ on the Node 22 release line, or Node 24/26+):

```bash
cd web
npm ci
npm run check
npm run dev
```

The shared package and lockfile live in `web/`; bend and impact resolve dependencies from `web/node_modules` without install hooks or sibling symlinks. `npm run check` runs both prototypes' tests, TypeScript checks, and the production build (`web/dist/`). `npm run dev` listens on `0.0.0.0` and `$PORT` when that variable is set, otherwise port 5173. Add `-- --host 127.0.0.1` to restrict the server to this computer.

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

One tapered tower and one shadow-casting directional light. The translucent shell is optional visible geometry. A slightly larger shell uses the same deformation field and renders only into PlayCanvas's offscreen relighting layer; it also casts shadows. The official `GSplatRelighting` script transfers that proxy lighting to the procedural Gaussians. Hide visible geometry to inspect splat lighting independently. Toggle **Relight splats** for an original/relit comparison, drag the gold sun to change its azimuth/elevation without orbiting the camera, and use the intensity/reset controls. This is a directional-sun feasibility test, not the release spotlight/aim interface.

Procedural Gaussians update center, rotation, and scale together. The HUD prints the tip quaternion, axial scale, and a two-second average FPS. Diagnostics refresh at 4 Hz. Navigation and hot module replacement release demo listeners, physics, custom materials, and splat resources; late physics initialization is disposed if the page has already been torn down.

See [LIMITATIONS.md](LIMITATIONS.md).

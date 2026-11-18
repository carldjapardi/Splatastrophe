# Local synthetic playground

Procedural bending for the synthetic tower. No reconstruction, dataset, or checkpoint is required.

The existing controller modules are reused by the TypeScript playground. The entry point in this folder loads `web/public/catalog.json`; application integration lives in `web/src/playground/`. The fixture is dynamically imported from its single source in `fixtures/physics/`. Only the synthetic tower fixture is supported; this catalog is not a final-splat adapter.

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

## What the playground shows

One configurable synthetic tower and one shadow-casting spotlight. Drag the gold marker to move the light on its current horizontal plane; drag the teal marker to aim it independently. Height sliders move each plane. Orbit pauses during handle dragging and resumes after release/cancellation. Intensity/color, light reset, camera reset and Reset all are separate controls. **Relight splats** compares original and proxy-modulated appearance; hide the visible mesh to inspect actual Gaussian shading.

The offscreen gray proxy uses the same deformation field as the tower splats and casts shadows onto the ground. PlayCanvas's official `GSplatRelighting` script transfers its lighting to splat fragments. This is approximate lighting, not recovered materials. Both procedural modes are visual/rigid-body prototypes, not PhysGaussian.

**Reload** disposes the current view and reloads the runtime catalog/fixture. Loading/validation/initialization failures disable controls and show **Retry loading**. Superseded loads are aborted; late resources are disposed. The catalog contains camera/lighting defaults and supported actions. Unsupported fixture types fail explicitly; final reconstruction loading and deformation/proxy compatibility are deferred.

Bend strength controls the kinematic target. Switching modes resets both controllers, then bend mode eases toward the selected strength; impact applies an impulse only when clicked/struck. Reset building clears the bend strength in bend mode, or restores all block poses/joints in impact mode. Reload restores catalog/query defaults.

**Inspect the prototype** exposes mesh/proxy/splat toggles, camera/light state, a two-second FPS average and a five-second sampling button. Diagnostics refresh at 4 Hz. Navigation/hot reload disposes listeners, physics, custom materials and splat resources. See [the local verification record](../../../experiments/viewer/2026-11-18-synthetic-playground.md) for device, browser, viewport, settings, measured results and limitations.

The production output is static `web/dist/`; this task does not deploy it. See [LIMITATIONS.md](LIMITATIONS.md).

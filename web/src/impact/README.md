# Impact prototype

Rigid-body impact for the synthetic tower. The block stack, joints, and solver settings live in `fixtures/physics/synthetic-tower.json`. Bending is a different mode and does not feed this solver.

## Run

The demo harness is the bend package, which imports this module:

```bash
cd web/src/deformation
npm install
npm test
npm run dev
```

Choose Impact in the page. Strike the upper face, or click a block. Reset before switching back to Bend. See [the bend README](../deformation/README.md) and [LIMITATIONS](../deformation/LIMITATIONS.md).

## API

`createImpactController(spec)` is async because it initializes Rapier.

- `impact(point, direction, strength)` — world point in meters, world direction, strength clamped to `[0, 2]`. Strength 1 applies `maxImpulse` newton-seconds at a body center, less farther away. A predefined joint breaks when the larger endpoint impulse reaches `breakImpulse`.
- `update(dt)` — fixed Rapier substeps.
- `reset()` — rest poses, zero velocity, joints restored.
- `dispose()` — frees the physics world.
- `getBodies()` — positions and quaternions `[x, y, z, w]`.
- `getConnections()` — which predefined joints are still intact.

Coordinates match the rest of the project: right-handed, Y-up, meters.

The solver is `@dimforge/rapier3d-compat`. Joint thresholds and density are demo values. Broken pieces collide with the ground. This is not a fracture model and not PhysGaussian.

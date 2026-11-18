# Limitations

This prototype is a visual controller for the synthetic tower. It is not a structural analysis and it is not a PhysGaussian reproduction.

## Bending

The bend is a scripted centerline. Height above the anchor uses the weight `(s / L)^2`, so the base stays fixed and the slope starts at zero. The centerline is the integral of the rotated up-axis. Cross-sections rotate with that tangent, and fibers off the neutral axis get a stretch `1 - curvature * offset`.

That is a kinematic shape, not continuum mechanics. There is no Young's modulus, no stress, no inertia, and no stored elastic energy. `setBend` eases toward a pose; it does not integrate internal force. Nothing here was compared to a measured beam or to a Material Point Method frame.

## Splats

The Gaussians are generated on a grid inside the procedural tower. They are not a Splatfacto or 3DGS reconstruction, and they have no spherical harmonics. View-dependent appearance is out of scope.

Each splat is updated as a rigid Gaussian plus an axial scale:

- position follows the same field as the mesh
- orientation is `bendRotation * restRotation`, quaternion `[x, y, z, w]`
- local Y scale is multiplied by the axial stretch
- covariance is `R diag(scale²) Rᵀ`

PlayCanvas's procedural splat container can store that rotation and scale. Its shader rebuilds covariance from them. The texture stores the quaternion as `(w, x, y, z)` because the engine swizzles it; the public API stays `[x, y, z, w]`.

If that container cannot be created, the demo falls back to oriented ellipsoid meshes and says so in the panel. Either way, centers alone are not the update.

Known renderer gaps:

- These splats do not receive the proxy shadow map. PlayCanvas draws Gaussian splats in their own pass, and this demo does not implement the documented proxy-relighting transfer.
- Half-float rotation is what the default container format stores. It is enough for this coarse grid and is not a full-precision covariance texture. The demo turns canvas antialiasing off because PlayCanvas warns that Gaussian splats in a multisampled framebuffer are several times more expensive.
- A real exported splat still needs stable IDs, scale/rotation conventions, and SH layout checked against the reconstruction exporter. That adapter is not in this prototype.

## Lighting proxy

The proxy is the same tapered shell, pushed out by `proxyOutset`, then deformed by the same field. It is the one shadow caster. The visible mesh is a second copy of the field, not a second solver. The ground shadow should follow the bend.

This does not relight splat colors. Captured illumination, double shadows, and silhouette mismatch are problems for a later lighting pass. There is exactly one shadow-casting light. The ambient term is a constant fill so the dark side stays readable.

## Impact

Impact is a separate mode and a separate representation: a prismatic block stack with the same footprint and overall height, not a fracture of the bent shell. Switching modes resets.

Rapier simulates rigid bodies. Predefined fixed joints are removed when the impulse applied by `impact()` reaches that joint's threshold. The solver does not estimate stress, and the thresholds are not material tests. Block density is intentionally light so a hit is visible. Pieces that break free fall and collide with the ground and with each other. Joints that are still intact do not collide with their partner, which keeps the intact stack from jittering.

`impact(point, direction, strength)` treats `strength` 1 as `maxImpulse` newton-seconds, with a linear falloff by distance from each body center. It is not a calibrated wrecking ball.

## What would make this more than a prototype

- Drive the same field from a real splat export and confirm covariance in the browser against a known rigid motion.
- Hand the proxy and the single light to the viewer shell once that scaffold exists, including splat relighting.
- Replace the scripted curve with either a checked live model or played-back PhysGaussian frames, and label which one is on screen.
- Derive breakable connections from the same components as the bend, instead of a parallel block stack.

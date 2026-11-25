import { BoundingBox, Mat4 } from 'playcanvas';
import type { GSplatComponent } from 'playcanvas';
import type { LandmarkMotionSpec } from './catalog';
import earthquakeShader from './landmarkEarthquake.glsl?raw';

export const earthquakeDuration = 4.8;

export function earthquakeStatus(elapsed: number) {
  if (elapsed < 1.05) return 'Ground shaking…';
  if (elapsed < 3.2) return 'Building breaking apart…';
  if (elapsed < earthquakeDuration) return 'Debris settling…';
  return 'Collapse complete. Replay or reset motion.';
}

export function createLandmarkEarthquake(
  splats: GSplatComponent,
  assetBounds: BoundingBox,
  rotationX: number,
  motion: LandmarkMotionSpec,
) {
  const bounds = new BoundingBox();
  bounds.setFromTransformedAabb(assetBounds, new Mat4().setFromEulerAngles(rotationX, 0, 0));
  const height = Math.max(bounds.getMax().z - motion.base[2], .001);
  splats.setParameter('uQuakeBaseHeight', new Float32Array([...motion.base, height]));
  splats.setParameter('uQuakeCell', new Float32Array([
    Math.max(.14 * height, motion.halfWidth / 6),
    Math.max(.18 * height, motion.halfDepth / 3),
    .14 * height,
  ]));
  splats.setParameter('uQuakeHalfWidth', motion.halfWidth);

  // Room for fragments if the camera moves away from the intact building's bounds.
  const collapseBounds = assetBounds.clone();
  collapseBounds.halfExtents.addScalar(.65 * height);

  let applied = false;
  return {
    start() {
      splats.customAabb = collapseBounds;
      splats.setParameter('uQuakeTime', 0);
      splats.setWorkBufferModifier({ glsl: earthquakeShader });
      applied = true;
    },
    update(elapsed: number) {
      splats.setParameter('uQuakeTime', Math.min(elapsed, earthquakeDuration));
    },
    reset() {
      if (!applied) return;
      splats.setWorkBufferModifier(null);
      splats.customAabb = null;
      applied = false;
    },
  };
}

import { BLEND_NORMAL, BoundingBox, CULLFACE_NONE, Entity, Mat4, StandardMaterial, Texture } from 'playcanvas';
import type { Application } from 'playcanvas';
import type { LandmarkMotionSpec } from './catalog';

type Motion = 'bounce' | 'sway';

const bounceArcs = [.72, .31, .13];
const swayDuration = 2.2;

export function sampleLandmarkMotion(action: Motion, elapsed: number, spec: LandmarkMotionSpec) {
  if (action === 'bounce') {
    for (const duration of bounceArcs) {
      if (elapsed < duration) {
        const phase = elapsed / duration;
        // A shorter arc has a lower apex at the same downward acceleration.
        const apex = spec.bounceHeight * (duration / bounceArcs[0]) ** 2;
        return { lift: 4 * apex * phase * (1 - phase), angle: 0 };
      }
      elapsed -= duration;
    }
    return null;
  }

  if (elapsed >= swayDuration) return null;
  const envelope = (1 - elapsed / swayDuration) ** 1.5;
  const angle = -0.11 * Math.sin(2 * Math.PI * elapsed / .95) * envelope;
  // Rotate about the base center and lift it just enough to keep the lower edge grounded.
  return { lift: spec.halfWidth * Math.abs(Math.sin(angle)), angle };
}

export function inferLandmarkMotion(assetBounds: BoundingBox, rotationX: number): LandmarkMotionSpec {
  const world = new BoundingBox();
  world.setFromTransformedAabb(assetBounds, new Mat4().setFromEulerAngles(rotationX, 0, 0));
  const { center, halfExtents } = world;
  return {
    base: [center.x, center.y, center.z - halfExtents.z],
    halfWidth: Math.max(halfExtents.x, .001),
    halfDepth: Math.max(halfExtents.y, .001),
    bounceHeight: Math.max(.3 * halfExtents.z, .001),
  };
}

export function mountLandmarkMotion(app: Application, landmark: Entity, spec: LandmarkMotionSpec, options: AddEventListenerOptions) {
  const [x, y, z] = spec.base;
  const rig = new Entity('Landmark motion');
  rig.setLocalPosition(x, y, z);
  landmark.setLocalPosition(-x, -y, -z);
  rig.addChild(landmark);
  app.root.addChild(rig);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(5, 7, 10, 0.78)');
  gradient.addColorStop(.48, 'rgba(14, 18, 24, 0.68)');
  gradient.addColorStop(.7, 'rgba(34, 42, 51, 0.38)');
  gradient.addColorStop(1, 'rgba(34, 42, 51, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);

  const texture = new Texture(app.graphicsDevice, { name: 'Landmark contact shadow' });
  texture.setSource(canvas);
  const material = new StandardMaterial();
  material.useLighting = false;
  material.diffuse.set(0, 0, 0);
  material.emissive.set(1, 1, 1);
  material.emissiveMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = CULLFACE_NONE;
  material.update();
  const shadow = new Entity('Landmark contact shadow');
  shadow.setLocalPosition(x, y, z);
  shadow.setLocalEulerAngles(90, 0, 0);
  shadow.addComponent('render', { type: 'plane', material, castShadows: false, receiveShadows: false });
  app.root.addChild(shadow);

  function place(lift: number, angle: number) {
    rig.setLocalPosition(x, y, z + lift);
    rig.setLocalEulerAngles(0, angle * 180 / Math.PI, 0);
    const separation = Math.min(lift / spec.bounceHeight, 1);
    const spread = 1 + .12 * separation;
    shadow.setLocalScale(2.6 * spec.halfWidth * spread, 1, 4 * spec.halfDepth * spread);
    material.opacity = 1 - .65 * separation;
  }
  const motion = bindBuildingMotion(app, spec, place, options);
  return () => {
    motion.dispose();
    shadow.destroy();
    material.destroy();
    texture.destroy();
  };
}

export function bindBuildingMotion(
  app: Application,
  spec: LandmarkMotionSpec,
  place: (lift: number, angle: number) => void,
  options: AddEventListenerOptions,
) {
  const bounce = document.querySelector<HTMLButtonElement>('#landmark-bounce')!;
  const sway = document.querySelector<HTMLButtonElement>('#landmark-sway')!;
  const status = document.querySelector('#landmark-motion-status')!;
  let action: Motion | undefined;
  let elapsed = 0;
  function reset() {
    action = undefined;
    bounce.removeAttribute('aria-disabled');
    sway.removeAttribute('aria-disabled');
    place(0, 0);
    status.textContent = 'Building at rest.';
  }
  function play(next: Motion) {
    if (action) return;
    action = next;
    elapsed = 0;
    bounce.setAttribute('aria-disabled', 'true');
    sway.setAttribute('aria-disabled', 'true');
    status.textContent = next === 'bounce' ? 'Bouncing…' : 'Swaying…';
  }

  bounce.addEventListener('click', () => play('bounce'), options);
  sway.addEventListener('click', () => play('sway'), options);
  document.querySelector('#landmark-motion-reset')!.addEventListener('click', reset, options);
  const update = app.on('update', (delta: number) => {
    if (!action) return;
    elapsed += delta;
    const pose = sampleLandmarkMotion(action, elapsed, spec);
    if (pose) place(pose.lift, pose.angle);
    else reset();
  });
  reset();

  return { reset, dispose: () => update.off() };
}

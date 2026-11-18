import {
  BoundingBox,
  Entity,
  GSplatContainer,
  GSplatFormat,
  Mesh,
  MeshInstance,
  StandardMaterial,
  Vec3,
  type AppBase,
} from 'playcanvas';
import type { SplatCloud } from '../splats';
import { floatToHalf } from './halfFloat';

export interface SplatView {
  kind: 'playcanvas-gsplat' | 'ellipsoid-fallback';
  /** Shown in the HUD. Explains renderer limits without hiding a failure. */
  note: string;
  update(cloud: SplatCloud): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * PlayCanvas stores a procedural splat quaternion as (w, x, y, z) in the
 * rotation texture. The shader swizzles it back to the [x, y, z, w] product
 * used to build covariance. Scales are linear radii, not log-scales.
 */
export function createSplatView(app: AppBase, cloud: SplatCloud): SplatView {
  try {
    return createGsplatView(app, cloud);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createEllipsoidFallback(app, cloud, message);
  }
}

function createGsplatView(app: AppBase, cloud: SplatCloud): SplatView {
  const device = app.graphicsDevice;
  const format = GSplatFormat.createDefaultFormat(device);
  const container = new GSplatContainer(device, cloud.count, format);
  const centerTex = container.getTexture('dataCenter');
  const colorTex = container.getTexture('dataColor');
  const scaleTex = container.getTexture('dataScale');
  const rotationTex = container.getTexture('dataRotation');
  if (!centerTex || !colorTex || !scaleTex || !rotationTex) {
    throw new Error('GSplatContainer is missing center, color, scale, or rotation streams');
  }

  writeColor(colorTex.lock(), cloud);
  colorTex.unlock();

  const bounds = new BoundingBox();
  const min = new Vec3();
  const max = new Vec3();
  container.centers = cloud.positions;
  writeDynamic(container, centerTex, scaleTex, rotationTex, cloud, bounds, min, max);
  container.aabb = bounds;
  container.update(cloud.count, true);

  const entity = new Entity('tower-splats');
  entity.addComponent('gsplat', { resource: container });
  app.root.addChild(entity);

  return {
    kind: 'playcanvas-gsplat',
    note: 'PlayCanvas GSplatContainer. Each splat writes position, [w,x,y,z] rotation, and linear scale; the renderer rebuilds covariance. Splats are not in the mesh shadow/lighting pass.',
    update(next) {
      writeDynamic(container, centerTex, scaleTex, rotationTex, next, bounds, min, max);
      container.aabb = bounds;
      container.update(next.count, true);
    },
    setVisible(visible) {
      entity.enabled = visible;
    },
    dispose() {
      entity.destroy();
      container.destroy();
    },
  };
}

function writeDynamic(
  container: GSplatContainer,
  centerTex: { lock(): ArrayBuffer | ArrayBufferView; unlock(): void },
  scaleTex: { lock(): ArrayBuffer | ArrayBufferView; unlock(): void },
  rotationTex: { lock(): ArrayBuffer | ArrayBufferView; unlock(): void },
  cloud: SplatCloud,
  bounds: BoundingBox,
  min: Vec3,
  max: Vec3,
): void {
  const centers = asFloats(centerTex.lock(), 'dataCenter');
  const scales = lockChannels(scaleTex.lock(), 'dataScale');
  const rotations = lockChannels(rotationTex.lock(), 'dataRotation');
  min.set(Infinity, Infinity, Infinity);
  max.set(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < cloud.count; i += 1) {
    const p = i * 3;
    const r = i * 4;
    const x = cloud.positions[p];
    const y = cloud.positions[p + 1];
    const z = cloud.positions[p + 2];
    centers[i * 4] = x;
    centers[i * 4 + 1] = y;
    centers[i * 4 + 2] = z;
    centers[i * 4 + 3] = 0;
    writeChannel(scales, i, cloud.scales[p], cloud.scales[p + 1], cloud.scales[p + 2], 0);
    // Texture order is w, x, y, z. See createSplatView.
    writeChannel(rotations, i, cloud.rotations[r + 3], cloud.rotations[r], cloud.rotations[r + 1], cloud.rotations[r + 2]);
    if (x < min.x) min.x = x;
    if (y < min.y) min.y = y;
    if (z < min.z) min.z = z;
    if (x > max.x) max.x = x;
    if (y > max.y) max.y = y;
    if (z > max.z) max.z = z;
  }
  centerTex.unlock();
  scaleTex.unlock();
  rotationTex.unlock();
  const pad = 0.4;
  min.sub(new Vec3(pad, pad, pad));
  max.add(new Vec3(pad, pad, pad));
  bounds.setMinMax(min, max);
  container.centers = cloud.positions;
}

function writeColor(buffer: ArrayBuffer | ArrayBufferView, cloud: SplatCloud): void {
  const channels = lockChannels(buffer, 'dataColor');
  for (let i = 0; i < cloud.count; i += 1) {
    const r = i * 4;
    writeChannel(channels, i, cloud.colors[r], cloud.colors[r + 1], cloud.colors[r + 2], cloud.colors[r + 3]);
  }
}

function asFloats(buffer: ArrayBuffer | ArrayBufferView, name: string): Float32Array {
  if (buffer instanceof Float32Array) return buffer;
  if (buffer instanceof ArrayBuffer) return new Float32Array(buffer);
  throw new Error(`${name} texture did not lock as float data`);
}

interface Channels {
  kind: 'f32' | 'f16';
  data: Float32Array | Uint16Array;
}

function lockChannels(buffer: ArrayBuffer | ArrayBufferView, name: string): Channels {
  if (buffer instanceof Float32Array) return { kind: 'f32', data: buffer };
  if (buffer instanceof Uint16Array) return { kind: 'f16', data: buffer };
  if (buffer instanceof ArrayBuffer) {
    return buffer.byteLength % 4 === 0
      ? { kind: 'f32', data: new Float32Array(buffer) }
      : { kind: 'f16', data: new Uint16Array(buffer) };
  }
  throw new Error(`${name} texture lock returned ${buffer.constructor.name}`);
}

function writeChannel(channels: Channels, index: number, a: number, b: number, c: number, d: number): void {
  const offset = index * 4;
  if (channels.kind === 'f32') {
    const data = channels.data as Float32Array;
    data[offset] = a;
    data[offset + 1] = b;
    data[offset + 2] = c;
    data[offset + 3] = d;
    return;
  }
  const data = channels.data as Uint16Array;
  data[offset] = floatToHalf(a);
  data[offset + 1] = floatToHalf(b);
  data[offset + 2] = floatToHalf(c);
  data[offset + 3] = floatToHalf(d);
}

function createEllipsoidFallback(app: AppBase, cloud: SplatCloud, reason: string): SplatView {
  const material = new StandardMaterial();
  material.diffuse.set(0.86, 0.55, 0.32);
  material.emissive.set(0.18, 0.08, 0.03);
  material.gloss = 0.2;
  material.useMetalness = true;
  material.metalness = 0;
  material.update();
  const root = new Entity('splat-ellipsoids');
  const entities: Entity[] = [];
  for (let i = 0; i < cloud.count; i += 1) {
    const entity = new Entity(`splat-${i}`);
    entity.addComponent('render', { type: 'sphere', material });
    root.addChild(entity);
    entities.push(entity);
  }
  app.root.addChild(root);
  const view: SplatView = {
    kind: 'ellipsoid-fallback',
    note: `PlayCanvas Gaussian renderer was not used (${reason}). Fallback draws oriented ellipsoids from the same rotation and scale.`,
    update(next) {
      for (let i = 0; i < next.count; i += 1) {
        const p = i * 3;
        const r = i * 4;
        const entity = entities[i];
        entity.setLocalPosition(next.positions[p], next.positions[p + 1], next.positions[p + 2]);
        entity.setLocalRotation(next.rotations[r], next.rotations[r + 1], next.rotations[r + 2], next.rotations[r + 3]);
        entity.setLocalScale(next.scales[p] * 2, next.scales[p + 1] * 2, next.scales[p + 2] * 2);
      }
    },
    setVisible(visible) {
      root.enabled = visible;
    },
    dispose() {
      root.destroy();
    },
  };
  view.update(cloud);
  return view;
}

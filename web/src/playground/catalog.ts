import { parseBendFixture } from '../deformation/src/fixture';
import { parseImpactFixture } from '../impact/src/index';

export type Point = [number, number, number];
export type Action = 'bend' | 'impact';
export interface SpotlightSpec {
  position: Point;
  target: Point;
  intensity: number;
  color: string;
  range: number;
  innerConeAngle: number;
  outerConeAngle: number;
}
interface BuildingIdentity {
  id: string;
  name: string;
  description: string;
  attribution: string;
}

interface OrbitCamera {
  yaw: number;
  pitch: number;
  distance: number;
  target: Point;
}

export interface BuildingEntry extends BuildingIdentity {
  fixture: 'synthetic-tower';
  actions: Action[];
  camera: OrbitCamera;
  light: SpotlightSpec;
}

export interface LandmarkEntry extends BuildingIdentity {
  fixture: 'static-sog';
  asset: string;
  camera: OrbitCamera & { rotationX: number };
  motion?: LandmarkMotionSpec;
}

export interface LandmarkMotionSpec {
  base: Point;
  halfWidth: number;
  halfDepth: number;
  bounceHeight: number;
}

export type CatalogEntry = BuildingEntry | LandmarkEntry;

export function parseCatalog(value: unknown): CatalogEntry[] {
  const root = record(value, 'catalog');
  if (root.schemaVersion !== 1 || !Array.isArray(root.buildings) || !root.buildings.length) {
    throw new Error('Catalog must declare schemaVersion 1 and at least one building');
  }
  const ids = new Set<string>();
  return root.buildings.map((value): CatalogEntry => {
    const entry = record(value, 'building');
    const id = label(entry.id, 'building.id');
    if (ids.has(id)) throw new Error(`Duplicate building id: ${id}`);
    ids.add(id);
    const identity = {
      id, name: label(entry.name, 'name'), description: label(entry.description, 'description'),
      attribution: label(entry.attribution, 'attribution'),
    };
    if (entry.fixture === 'static-sog') {
      const asset = label(entry.asset, 'building.asset');
      if (!/^models\/[a-z\d]+(?:-[a-z\d]+)*\.sog$/.test(asset)) {
        throw new Error(`Invalid local SOG path for ${id}`);
      }
      const camera = record(entry.camera, 'camera');
      const motion = entry.motion === undefined ? undefined : record(entry.motion, 'motion');
      return {
        ...identity, fixture: entry.fixture, asset,
        camera: {
          ...parseCamera(camera, [-1.4, 1.4], [.05, 100]),
          rotationX: bounded(camera.rotationX, 'camera.rotationX', -360, 360),
        },
        motion: motion && {
          base: point(motion.base, 'motion.base'),
          halfWidth: bounded(motion.halfWidth, 'motion.halfWidth', .001, 30),
          halfDepth: bounded(motion.halfDepth, 'motion.halfDepth', .001, 30),
          bounceHeight: bounded(motion.bounceHeight, 'motion.bounceHeight', .001, 30),
        },
      };
    }
    if (entry.fixture !== 'synthetic-tower') throw new Error(`Unsupported fixture for ${id}`);
    if (!Array.isArray(entry.actions) || !entry.actions.length
      || entry.actions.some((action) => action !== 'bend' && action !== 'impact')
      || new Set(entry.actions).size !== entry.actions.length) throw new Error(`Invalid actions for ${id}`);
    const camera = record(entry.camera, 'camera');
    const light = record(entry.light, 'light');
    const inner = bounded(light.innerConeAngle, 'innerConeAngle', 1, 85);
    const outer = bounded(light.outerConeAngle, 'outerConeAngle', inner, 89);
    const position = point(light.position, 'light.position');
    const target = point(light.target, 'light.target');
    bounded(position[1], 'light.position height', 1, 10);
    bounded(target[1], 'light.target height', 0, 8);
    if (Math.hypot(...position.map((value, i) => value - target[i])) < 0.1) throw new Error('Light position and aim must differ');
    const color = label(light.color, 'light.color');
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Light color must be #rrggbb');
    return {
      ...identity, fixture: entry.fixture,
      actions: entry.actions as Action[],
      camera: parseCamera(camera, [-.2, 1.15], [4, 28]),
      light: { position, target, color, intensity: bounded(light.intensity, 'intensity', 0, 12),
        range: bounded(light.range, 'light.range', 1, 80), innerConeAngle: inner, outerConeAngle: outer },
    };
  });
}

export async function loadCatalog(signal: AbortSignal): Promise<CatalogEntry[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}catalog.json`, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Building catalog could not be loaded (HTTP ${response.status})`);
  return parseCatalog(await response.json());
}

export async function loadFixture(entry: BuildingEntry, signal: AbortSignal) {
  signal.throwIfAborted();
  if (entry.fixture !== 'synthetic-tower') throw new Error('Unsupported fixture');
  const data = await import('../../../fixtures/physics/synthetic-tower.json');
  signal.throwIfAborted();
  return { bend: parseBendFixture(data.default), impact: parseImpactFixture(data.default) };
}
export type LoadedFixture = Awaited<ReturnType<typeof loadFixture>>;

function parseCamera(camera: Record<string, unknown>, pitch: [number, number], distance: [number, number]): OrbitCamera {
  return {
    yaw: bounded(camera.yaw, 'camera.yaw', -Math.PI * 2, Math.PI * 2),
    pitch: bounded(camera.pitch, 'camera.pitch', ...pitch),
    distance: bounded(camera.distance, 'camera.distance', ...distance),
    target: point(camera.target, 'camera.target'),
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function label(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be nonempty text`);
  return value;
}
function bounded(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number from ${min} to ${max}`);
  }
  return value;
}
function point(value: unknown, name: string): Point {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name} must be [x, y, z]`);
  return value.map((value) => bounded(value, name, -30, 30)) as Point;
}

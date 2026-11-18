import type { Vec3 } from './math';
import type { BendSpec, TowerSpec } from './types';

export interface DirectionalLightSpec {
  type: 'directional';
  count: 1;
  castShadow: true;
  direction: Vec3;
  color: Vec3;
  intensity: number;
  ambient: Vec3;
}

export interface BendFixture {
  id: string;
  tower: TowerSpec;
  bend: BendSpec;
  light: DirectionalLightSpec;
}

/** Reads the bend, tower, and single-light portions of the shared fixture. */
export function parseBendFixture(data: unknown): BendFixture {
  const root = asRecord(data, 'fixture');
  const building = asRecord(root.building, 'building');
  const bend = asRecord(root.bend, 'bend');
  const light = asRecord(root.light, 'light');
  if (light.type !== 'directional' || light.count !== 1 || light.castShadow !== true) {
    throw new Error('synthetic tower fixture must declare exactly one shadow-casting directional light');
  }
  if (bend.heightWeight !== 'quadratic') {
    throw new Error('bend.heightWeight must be "quadratic"');
  }
  const base = asRecord(building.base, 'building.base');
  const top = asRecord(building.top, 'building.top');
  const tower: TowerSpec = {
    center: vec3(building.center, 'building.center'),
    height: positive(building.height, 'building.height'),
    base: { width: positive(base.width, 'base.width'), depth: positive(base.depth, 'base.depth') },
    top: { width: positive(top.width, 'top.width'), depth: positive(top.depth, 'top.depth') },
    anchorHeight: nonNegative(building.anchorHeight, 'building.anchorHeight'),
    heightSegments: positive(building.heightSegments, 'building.heightSegments'),
  };
  if (tower.anchorHeight >= tower.height) {
    throw new Error('anchorHeight must sit below the tower height');
  }
  return {
    id: typeof root.id === 'string' ? root.id : 'synthetic-tower',
    tower,
    bend: {
      maxTipAngleRadians: positive(bend.maxTipAngleRadians, 'bend.maxTipAngleRadians'),
      heightWeight: 'quadratic',
      responseSeconds: nonNegative(bend.responseSeconds, 'bend.responseSeconds'),
      splatGrid: vec3(bend.splatGrid, 'bend.splatGrid'),
      splatScale: vec3(bend.splatScale, 'bend.splatScale'),
      splatInset: nonNegative(bend.splatInset, 'bend.splatInset'),
      proxyOutset: nonNegative(bend.proxyOutset, 'bend.proxyOutset'),
    },
    light: {
      type: 'directional',
      count: 1,
      castShadow: true,
      direction: vec3(light.direction, 'light.direction'),
      color: vec3(light.color, 'light.color'),
      intensity: positive(light.intensity, 'light.intensity'),
      ambient: vec3(light.ambient, 'light.ambient'),
    },
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function vec3(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error(`${label} must be a finite [x, y, z]`);
  }
  return [value[0], value[1], value[2]];
}

function positive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

function nonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

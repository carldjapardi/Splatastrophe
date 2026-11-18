import type { Quat, Vec3 } from './math';

export type { Quat, Vec3 };

/** One sample of the shared bend field. Rotation is [x, y, z, w]. */
export interface BendSample {
  position: [number, number, number];
  /** Extra rotation applied on top of a rest pose. Identity while anchored. */
  rotation: Quat;
  /** Scale factor along the tower axis after bending. 1 on the centerline. */
  axialStretch: number;
  anchored: boolean;
}

export interface BendField {
  readonly strength: number;
  /** Unit horizontal direction, or zero when there is no bend. */
  readonly direction: Vec3;
  readonly tipAngle: number;
  sample(restPosition: Vec3): BendSample;
}

export interface BendController {
  setBend(strength: number, direction: Vec3): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
  getField(): BendField;
  readonly currentStrength: number;
  readonly currentDirection: Vec3;
  readonly disposed: boolean;
}

export interface TowerSpec {
  center: Vec3;
  height: number;
  base: { width: number; depth: number };
  top: { width: number; depth: number };
  anchorHeight: number;
  heightSegments: number;
}

export interface BendSpec {
  maxTipAngleRadians: number;
  heightWeight: 'quadratic';
  responseSeconds: number;
  splatGrid: readonly [number, number, number];
  splatScale: Vec3;
  splatInset: number;
  proxyOutset: number;
}

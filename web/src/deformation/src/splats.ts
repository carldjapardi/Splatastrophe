import {
  QUAT_IDENTITY,
  covarianceFromPose,
  quatMul,
  quatNormalize,
  type Quat,
  type Vec3,
} from './math';
import type { BendField, BendSample, TowerSpec } from './types';

export interface SplatCloud {
  count: number;
  restPositions: Float32Array;
  restRotations: Float32Array;
  restScales: Float32Array;
  colors: Float32Array;
  positions: Float32Array;
  rotations: Float32Array;
  scales: Float32Array;
}

export interface DeformedSplat {
  position: [number, number, number];
  rotation: Quat;
  scale: [number, number, number];
  /** Row-major 3x3 covariance, Σ = R diag(scale²) Rᵀ, after the bend. */
  covariance: number[];
  anchored: boolean;
}

export interface SplatBuildOptions {
  grid: readonly [number, number, number];
  scale: Vec3;
  inset: number;
}

/**
 * Deterministic Gaussians packed inside the tower. Rest orientation is identity,
 * with local Y along the tower so a bend shows up as rotation, not just a new center.
 */
export function buildTowerSplats(tower: TowerSpec, options: SplatBuildOptions): SplatCloud {
  const [nx, ny, nz] = options.grid.map((count) => Math.max(1, Math.floor(count))) as [number, number, number];
  const count = nx * ny * nz;
  const restPositions = new Float32Array(count * 3);
  const restRotations = new Float32Array(count * 4);
  const restScales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  let index = 0;
  for (let iy = 0; iy < ny; iy += 1) {
    for (let iz = 0; iz < nz; iz += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const y = ny === 1
          ? tower.height * 0.5
          : options.inset + ((tower.height - options.inset * 2) * iy) / (ny - 1);
        const t = tower.height <= 0 ? 0 : y / tower.height;
        const halfW = (tower.base.width + (tower.top.width - tower.base.width) * t) * 0.5 - options.inset;
        const halfD = (tower.base.depth + (tower.top.depth - tower.base.depth) * t) * 0.5 - options.inset;
        const x = tower.center[0] + (nx === 1 ? 0 : (ix / (nx - 1) - 0.5) * 2 * halfW);
        const z = tower.center[2] + (nz === 1 ? 0 : (iz / (nz - 1) - 0.5) * 2 * halfD);
        const o = index * 3;
        restPositions[o] = x;
        restPositions[o + 1] = y;
        restPositions[o + 2] = z;
        const r = index * 4;
        restRotations[r] = 0;
        restRotations[r + 1] = 0;
        restRotations[r + 2] = 0;
        restRotations[r + 3] = 1;
        restScales[o] = options.scale[0];
        restScales[o + 1] = options.scale[1];
        restScales[o + 2] = options.scale[2];
        const shade = tower.height <= 0 ? 0 : y / tower.height;
        colors[r] = 0.78 - shade * 0.18;
        colors[r + 1] = 0.62 - shade * 0.16;
        colors[r + 2] = 0.46 - shade * 0.08;
        colors[r + 3] = 0.9;
        index += 1;
      }
    }
  }
  return {
    count,
    restPositions,
    restRotations,
    restScales,
    colors,
    positions: new Float32Array(restPositions),
    rotations: new Float32Array(restRotations),
    scales: new Float32Array(restScales),
  };
}

/** Rotation, per-axis scale, and covariance for one rest Gaussian under the field. */
export function deformSplat(
  restPosition: Vec3,
  restRotation: Quat,
  restScale: Vec3,
  sample: BendSample,
): DeformedSplat {
  const rotation = sample.anchored
    ? quatNormalize(restRotation)
    : quatNormalize(quatMul(sample.rotation, restRotation));
  const scale: [number, number, number] = [
    restScale[0],
    restScale[1] * sample.axialStretch,
    restScale[2],
  ];
  return {
    position: sample.position,
    rotation,
    scale,
    covariance: covarianceFromPose(rotation, scale),
    anchored: sample.anchored,
  };
}

export function deformSplats(cloud: SplatCloud, field: BendField): void {
  for (let i = 0; i < cloud.count; i += 1) {
    const p = i * 3;
    const r = i * 4;
    const sample = field.sample([
      cloud.restPositions[p],
      cloud.restPositions[p + 1],
      cloud.restPositions[p + 2],
    ]);
    const deformed = deformSplat(
      [cloud.restPositions[p], cloud.restPositions[p + 1], cloud.restPositions[p + 2]],
      [cloud.restRotations[r], cloud.restRotations[r + 1], cloud.restRotations[r + 2], cloud.restRotations[r + 3]],
      [cloud.restScales[p], cloud.restScales[p + 1], cloud.restScales[p + 2]],
      sample,
    );
    cloud.positions[p] = deformed.position[0];
    cloud.positions[p + 1] = deformed.position[1];
    cloud.positions[p + 2] = deformed.position[2];
    cloud.rotations[r] = deformed.rotation[0];
    cloud.rotations[r + 1] = deformed.rotation[1];
    cloud.rotations[r + 2] = deformed.rotation[2];
    cloud.rotations[r + 3] = deformed.rotation[3];
    cloud.scales[p] = deformed.scale[0];
    cloud.scales[p + 1] = deformed.scale[1];
    cloud.scales[p + 2] = deformed.scale[2];
  }
}

export { QUAT_IDENTITY };

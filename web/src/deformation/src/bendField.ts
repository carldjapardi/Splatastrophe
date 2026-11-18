import {
  QUAT_IDENTITY,
  add,
  clamp,
  horizontalUnit,
  lerp,
  quatFromAxisAngle,
  quatRotate,
  scale,
  type Vec3,
} from './math';
import type { BendField, BendSample, TowerSpec } from './types';

const CENTERLINE_STEPS = 96;
const MIN_STRETCH = 0.25;
const MAX_STRETCH = 2.5;

export interface BendFieldInput {
  tower: TowerSpec;
  /** Fraction of `maxTipAngleRadians`, clamped to [0, 1]. */
  strength: number;
  /** World direction. Vertical component is ignored. */
  direction: Vec3;
  maxTipAngleRadians: number;
}

/**
 * Height-weighted bend. Angle along the free height is `tipAngle * (s / L)^2`,
 * so the anchor stays fixed and the slope is continuous there. The centerline
 * is the integral of the rotated up-axis. Cross-sections rotate with that
 * tangent, and fibers off the neutral axis stretch by `1 - curvature * offset`.
 */
export function createBendField(input: BendFieldInput): BendField {
  const { tower } = input;
  const strength = clamp(input.strength, 0, 1);
  const direction = horizontalUnit(input.direction);
  const deformable = Math.max(0, tower.height - tower.anchorHeight);
  const tipAngle = strength * input.maxTipAngleRadians;
  const active = tipAngle > 1e-6 && deformable > 1e-6 && (direction[0] !== 0 || direction[2] !== 0);
  const bendAxis: Vec3 = active ? [direction[2], 0, -direction[0]] : [0, 0, 1];
  const samples = active ? integrateCenterline(tower, bendAxis, tipAngle, deformable) : null;

  return {
    strength,
    direction,
    tipAngle: active ? tipAngle : 0,
    sample(restPosition: Vec3): BendSample {
      const heightAbove = restPosition[1] - tower.anchorHeight;
      if (!active || !samples || heightAbove <= 1e-6) {
        return {
          position: [restPosition[0], restPosition[1], restPosition[2]],
          rotation: QUAT_IDENTITY,
          axialStretch: 1,
          anchored: true,
        };
      }
      const s = Math.min(heightAbove, deformable);
      const centerline = samplePolyline(samples.positions, s, deformable);
      const t = s / deformable;
      const angle = tipAngle * t * t;
      const rotation = quatFromAxisAngle(bendAxis, angle);
      const offset: Vec3 = [
        restPosition[0] - tower.center[0],
        0,
        restPosition[2] - tower.center[2],
      ];
      const rotated = quatRotate(rotation, offset);
      const position = add(centerline, rotated);
      const curvature = deformable > 0 ? (2 * tipAngle * t) / deformable : 0;
      const signedOffset = offset[0] * direction[0] + offset[2] * direction[2];
      const axialStretch = clamp(1 - curvature * signedOffset, MIN_STRETCH, MAX_STRETCH);
      return {
        position,
        rotation,
        axialStretch,
        anchored: false,
      };
    },
  };
}

function integrateCenterline(
  tower: TowerSpec,
  bendAxis: Vec3,
  tipAngle: number,
  deformable: number,
): { positions: [number, number, number][] } {
  const steps = CENTERLINE_STEPS;
  const ds = deformable / steps;
  const positions: [number, number, number][] = [[tower.center[0], tower.anchorHeight, tower.center[2]]];
  let cursor: [number, number, number] = [tower.center[0], tower.anchorHeight, tower.center[2]];
  for (let i = 0; i < steps; i += 1) {
    const mid = (i + 0.5) * ds;
    const midT = mid / deformable;
    const midAngle = tipAngle * midT * midT;
    const tangent = quatRotate(quatFromAxisAngle(bendAxis, midAngle), [0, 1, 0]);
    cursor = add(cursor, scale(tangent, ds));
    positions.push(cursor);
  }
  return { positions };
}

function samplePolyline(
  positions: readonly [number, number, number][],
  s: number,
  length: number,
): [number, number, number] {
  const steps = positions.length - 1;
  const f = (s / length) * steps;
  const index = Math.min(steps - 1, Math.max(0, Math.floor(f)));
  const t = f - index;
  return lerp(positions[index], positions[index + 1], t);
}

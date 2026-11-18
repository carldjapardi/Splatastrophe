import { clamp, horizontalUnit, type Vec3 } from './math';
import { createBendField } from './bendField';
import type { BendController, BendField, TowerSpec } from './types';

export type { BendController };

export interface BendControllerOptions {
  tower: TowerSpec;
  maxTipAngleRadians: number;
  /** Seconds to ease most of the way to a new target. 0 snaps. */
  responseSeconds?: number;
}

/**
 * Live bend target. `setBend` stores the request, `update` eases the field
 * toward it, and `getField` is what meshes, the lighting proxy, and splats share.
 */
export function createBendController(options: BendControllerOptions): BendController {
  const responseSeconds = Math.max(0, options.responseSeconds ?? 0.4);
  let targetStrength = 0;
  let targetDirection: [number, number, number] = [1, 0, 0];
  let currentStrength = 0;
  let currentDirection: [number, number, number] = [1, 0, 0];
  let disposed = false;

  function field(): BendField {
    return createBendField({
      tower: options.tower,
      strength: currentStrength,
      direction: currentDirection,
      maxTipAngleRadians: options.maxTipAngleRadians,
    });
  }

  const controller: BendController = {
    get disposed() {
      return disposed;
    },
    get currentStrength() {
      return currentStrength;
    },
    get currentDirection() {
      return currentDirection;
    },
    setBend(strength: number, direction: Vec3) {
      assertLive();
      const horizontal = horizontalUnit(direction);
      if (horizontal[0] === 0 && horizontal[2] === 0) {
        targetStrength = 0;
        return;
      }
      targetStrength = clamp(strength, 0, 1);
      targetDirection = horizontal;
    },
    update(dt: number) {
      if (disposed) return;
      const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const alpha = responseSeconds <= 1e-6 ? 1 : 1 - Math.exp(-step / responseSeconds);
      currentStrength += (targetStrength - currentStrength) * alpha;
      currentDirection = [
        currentDirection[0] + (targetDirection[0] - currentDirection[0]) * alpha,
        0,
        currentDirection[2] + (targetDirection[2] - currentDirection[2]) * alpha,
      ];
      const renormalized = horizontalUnit(currentDirection);
      if (renormalized[0] !== 0 || renormalized[2] !== 0) currentDirection = renormalized;
      if (currentStrength < 1e-5 && targetStrength === 0) currentStrength = 0;
    },
    reset() {
      assertLive();
      targetStrength = 0;
      currentStrength = 0;
      targetDirection = [1, 0, 0];
      currentDirection = [1, 0, 0];
    },
    dispose() {
      disposed = true;
      targetStrength = 0;
      currentStrength = 0;
    },
    getField() {
      assertLive();
      return field();
    },
  };

  function assertLive() {
    if (disposed) throw new Error('BendController is disposed');
  }

  return controller;
}

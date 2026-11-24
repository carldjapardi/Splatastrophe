import { describe, expect, it } from 'vitest';
import type { LandmarkMotionSpec } from '../src/playground/catalog';
import { sampleLandmarkMotion } from '../src/playground/landmarkMotion';

const spec: LandmarkMotionSpec = { base: [0, 0, 0], halfWidth: .09, halfDepth: .02, bounceHeight: .036 };

describe('landmark motion', () => {
  it('bounces above ground with a smaller rebound and settles', () => {
    expect(sampleLandmarkMotion('bounce', 0, spec)).toEqual({ lift: 0, angle: 0 });
    const apex = sampleLandmarkMotion('bounce', .36, spec)!;
    expect(apex.lift).toBeCloseTo(spec.bounceHeight);
    expect(sampleLandmarkMotion('bounce', .72, spec)?.lift).toBeCloseTo(0);
    const rebound = sampleLandmarkMotion('bounce', .875, spec)!;
    expect(rebound.lift).toBeGreaterThan(0);
    expect(rebound.lift).toBeLessThan(apex.lift);
    expect(sampleLandmarkMotion('bounce', 1.2, spec)).toBeNull();
  });

  it('rocks left then right with a grounded lower edge and diminishing tilt', () => {
    const left = sampleLandmarkMotion('sway', .24, spec)!;
    const right = sampleLandmarkMotion('sway', .71, spec)!;
    expect(left.angle).toBeLessThan(0);
    expect(right.angle).toBeGreaterThan(0);
    expect(right.angle).toBeLessThan(-left.angle);
    for (const { angle, lift } of [left, right]) {
      expect(lift - spec.halfWidth * Math.abs(Math.sin(angle))).toBeCloseTo(0);
    }
    expect(sampleLandmarkMotion('sway', 2.2, spec)).toBeNull();
  });
});

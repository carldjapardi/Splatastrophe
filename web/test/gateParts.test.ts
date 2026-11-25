import { describe, expect, it } from 'vitest';
import { gateParts, gatePartIndex, gateSpec, gateModifier } from '../src/playground/gateParts';

describe('coarse gate membership', () => {
  it('assigns each proxy center to its stable part index', () => {
    expect(gateParts).toHaveLength(13);
    gateParts.forEach((part, i) => expect(gatePartIndex(part.center)).toBe(i));
  });
  it('preserves background and rejects invalid points', () => {
    expect(gatePartIndex([3, 0, 0])).toBe(-1);
    expect(gatePartIndex([NaN, 0, 0])).toBe(-1);
    expect(gatePartIndex([])).toBe(-1);
  });
  it('assigns seams consistently and leaves no ambiguous membership', () => {
    expect(gatePartIndex([gateSpec.roofEdges[1], .35, 0])).toBe(7);
    expect(gatePartIndex([.035, .35, gateSpec.roofTop])).toBe(12);
    expect(gatePartIndex([0, .35, gateSpec.roofTop])).toBe(7);
    expect(gatePartIndex([.12, .35, gateSpec.roofTop + .001])).toBe(11);
    expect(gatePartIndex([0, .35, gateSpec.columnTop])).toBe(7);
    expect(gateModifier).toContain('partRotations[13]');
  });
});

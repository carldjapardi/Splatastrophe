import { expect, it } from 'vitest';
import { updateGateSortCenters } from '../src/playground/gateBreaking';

it('moves sorting centers in the same viewer frame as rendered splats', () => {
  const rest = new Float32Array([1, -2, -3, 4, 5, 6]);
  const result = new Float32Array(6);
  const transform = new Float32Array([0, -1, 0, 10, 1, 0, 0, 20, 0, 0, 1, 30]);
  updateGateSortCenters(rest, new Int8Array([0, -1]), transform, result);
  expect(Array.from(result)).toEqual([8, -21, -33, 4, 5, 6]);
  expect(Array.from(rest)).toEqual([1, -2, -3, 4, 5, 6]);
});

import type { Point } from './catalog';

/** Intersects a camera ray with a horizontal drag plane. */
export function pointOnPlane(start: Point, end: Point, height: number): Point | null {
  const dy = end[1] - start[1];
  if (Math.abs(dy) < 1e-6) return null;
  const t = (height - start[1]) / dy;
  if (t < 0) return null;
  return [start[0] + (end[0] - start[0]) * t, height, start[2] + (end[2] - start[2]) * t];
}

/** Right-handed, Y-up vectors and quaternions stored as [x, y, z, w]. */

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

export function add(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): [number, number, number] {
  const len = length(a);
  if (len < 1e-8) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function lerp(a: Vec3, b: Vec3, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Horizontal part of a direction. Y is discarded. Returns a unit XZ vector or zero. */
export function horizontalUnit(direction: Vec3): [number, number, number] {
  const x = direction[0];
  const z = direction[2];
  const len = Math.hypot(x, z);
  if (len < 1e-8) return [0, 0, 0];
  return [x / len, 0, z / len];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const unit = normalize(axis);
  if (unit[0] === 0 && unit[1] === 0 && unit[2] === 0 || Math.abs(angle) < 1e-10) {
    return QUAT_IDENTITY;
  }
  const half = angle * 0.5;
  const s = Math.sin(half);
  return [unit[0] * s, unit[1] * s, unit[2] * s, Math.cos(half)];
}

/** Hamilton product. Applies `b` first, then `a`, for column vectors. */
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < 1e-8) return QUAT_IDENTITY;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatRotate(q: Quat, v: Vec3): [number, number, number] {
  const qv: [number, number, number] = [q[0], q[1], q[2]];
  const t = scale(cross(qv, v), 2);
  return add(add(v, scale(t, q[3])), cross(qv, t));
}

/**
 * World-space covariance of an axis-aligned Gaussian after rotation and scale.
 * Scales are linear radii, not log-scales. The matrix is row-major 3x3.
 */
export function covarianceFromPose(rotation: Quat, scaleVec: Vec3): number[] {
  const q = quatNormalize(rotation);
  const axes = [
    quatRotate(q, [1, 0, 0]),
    quatRotate(q, [0, 1, 0]),
    quatRotate(q, [0, 0, 1]),
  ];
  const variances = [scaleVec[0] * scaleVec[0], scaleVec[1] * scaleVec[1], scaleVec[2] * scaleVec[2]];
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 3; k += 1) {
    const axis = axes[k];
    const variance = variances[k];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        cov[row * 3 + col] += variance * axis[row] * axis[col];
      }
    }
  }
  return cov;
}

export function covarianceQuadraticForm(cov: readonly number[], v: Vec3): number {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const rx = cov[0] * x + cov[1] * y + cov[2] * z;
  const ry = cov[3] * x + cov[4] * y + cov[5] * z;
  const rz = cov[6] * x + cov[7] * y + cov[8] * z;
  return x * rx + y * ry + z * rz;
}

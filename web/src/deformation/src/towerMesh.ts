import { cross, dot, normalize, sub, type Vec3 } from './math';
import type { BendField, TowerSpec } from './types';

export interface TowerMeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  deformedPositions: Float32Array;
  deformedNormals: Float32Array;
}

export interface TowerMeshOptions {
  /** Push side and top vertices outward so a lighting shell can sit outside the visible mesh. */
  outset?: number;
}

/** Closed tapered box. The base sits on y = 0. Faces do not share vertices, so normals stay flat. */
export function buildTowerMesh(tower: TowerSpec, options: TowerMeshOptions = {}): TowerMeshData {
  const outset = options.outset ?? 0;
  const segments = Math.max(1, Math.floor(tower.heightSegments));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const ringAt = (y: number): Vec3[] => {
    const t = tower.height <= 0 ? 0 : y / tower.height;
    const width = tower.base.width + (tower.top.width - tower.base.width) * t;
    const depth = tower.base.depth + (tower.top.depth - tower.base.depth) * t;
    const hx = width * 0.5;
    const hz = depth * 0.5;
    const corners: Vec3[] = [
      [tower.center[0] - hx, y, tower.center[2] - hz],
      [tower.center[0] + hx, y, tower.center[2] - hz],
      [tower.center[0] + hx, y, tower.center[2] + hz],
      [tower.center[0] - hx, y, tower.center[2] + hz],
    ];
    return corners.map((corner) => pushOut(corner, tower, outset));
  };

  const centerHint: Vec3 = [tower.center[0], tower.height * 0.5, tower.center[2]];
  for (let i = 0; i < segments; i += 1) {
    const y0 = (tower.height * i) / segments;
    const y1 = (tower.height * (i + 1)) / segments;
    const bottom = ringAt(y0);
    const top = ringAt(y1);
    for (let face = 0; face < 4; face += 1) {
      const next = (face + 1) % 4;
      addQuad(positions, normals, uvs, indices, [
        bottom[face],
        bottom[next],
        top[next],
        top[face],
      ], centerHint);
    }
  }
  const topRing = ringAt(tower.height);
  const bottomRing = ringAt(0);
  addQuad(positions, normals, uvs, indices, [topRing[0], topRing[1], topRing[2], topRing[3]], centerHint);
  addQuad(positions, normals, uvs, indices, [bottomRing[0], bottomRing[3], bottomRing[2], bottomRing[1]], centerHint);

  const positionArray = Float32Array.from(positions);
  const normalArray = Float32Array.from(normals);
  return {
    positions: positionArray,
    normals: normalArray,
    uvs: Float32Array.from(uvs),
    indices: Uint16Array.from(indices),
    deformedPositions: new Float32Array(positionArray),
    deformedNormals: new Float32Array(normalArray),
  };
}

/** Writes the shared bend field into `deformedPositions` and `deformedNormals`. */
export function deformTowerMesh(mesh: TowerMeshData, field: BendField): void {
  const { positions, normals, deformedPositions, deformedNormals } = mesh;
  for (let i = 0; i < positions.length; i += 3) {
    const sample = field.sample([positions[i], positions[i + 1], positions[i + 2]]);
    deformedPositions[i] = sample.position[0];
    deformedPositions[i + 1] = sample.position[1];
    deformedPositions[i + 2] = sample.position[2];
    const normal = sample.anchored
      ? [normals[i], normals[i + 1], normals[i + 2]] as const
      : rotateNormal(sample.rotation, [normals[i], normals[i + 1], normals[i + 2]]);
    deformedNormals[i] = normal[0];
    deformedNormals[i + 1] = normal[1];
    deformedNormals[i + 2] = normal[2];
  }
}

function rotateNormal(rotation: readonly [number, number, number, number], normal: Vec3): [number, number, number] {
  const [x, y, z, w] = rotation;
  const qv: Vec3 = [x, y, z];
  const t = cross(qv, normal);
  const t2 = cross(qv, t);
  return normalize([
    normal[0] + 2 * (w * t[0] + t2[0]),
    normal[1] + 2 * (w * t[1] + t2[1]),
    normal[2] + 2 * (w * t[2] + t2[2]),
  ]);
}

function pushOut(corner: Vec3, tower: TowerSpec, outset: number): Vec3 {
  if (outset === 0) return corner;
  const dx = corner[0] - tower.center[0];
  const dz = corner[2] - tower.center[2];
  const len = Math.hypot(dx, dz);
  const y = corner[1] >= tower.height - 1e-4 ? corner[1] + outset : corner[1];
  if (len < 1e-8) return [corner[0], y, corner[2]];
  return [corner[0] + (dx / len) * outset, y, corner[2] + (dz / len) * outset];
}

function addQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  verts: [Vec3, Vec3, Vec3, Vec3],
  centerHint: Vec3,
): void {
  const edgeA = sub(verts[1], verts[0]);
  const edgeB = sub(verts[3], verts[0]);
  let normal = normalize(cross(edgeA, edgeB));
  let ordered: Vec3[] = verts;
  const midpoint: Vec3 = [
    (verts[0][0] + verts[1][0] + verts[2][0] + verts[3][0]) * 0.25,
    (verts[0][1] + verts[1][1] + verts[2][1] + verts[3][1]) * 0.25,
    (verts[0][2] + verts[1][2] + verts[2][2] + verts[3][2]) * 0.25,
  ];
  if (dot(normal, sub(midpoint, centerHint)) < 0) {
    normal = [-normal[0], -normal[1], -normal[2]];
    ordered = [verts[0], verts[3], verts[2], verts[1]];
  }
  const start = positions.length / 3;
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = 0; i < 4; i += 1) {
    positions.push(ordered[i][0], ordered[i][1], ordered[i][2]);
    normals.push(normal[0], normal[1], normal[2]);
    uvs.push(uv[i][0], uv[i][1]);
  }
  indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

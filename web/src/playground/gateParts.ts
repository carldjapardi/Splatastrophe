import spec from '../../../experiments/dbw/gate-browser-parts.json';
import type { BreakingPart } from './breakingPhysics';

export const gateSpec = spec;

export const gateParts: BreakingPart[] = [
  ...spec.columnX.map((x, i) => ({
    id: `column-${i + 1}`, name: `Column ${i + 1} (left to right)`,
    center: [x, (spec.columnDepth[0] + spec.columnDepth[1]) / 2, (spec.groundZ + spec.columnTop) / 2] as [number, number, number],
    halfSize: [spec.columnHalfWidth, (spec.columnDepth[1] - spec.columnDepth[0]) / 2, (spec.columnTop - spec.groundZ) / 2] as [number, number, number],
  })),
  ...spec.roofEdges.slice(0, -1).map((x, i) => ({
    id: `roof-${i + 1}`, name: `Roof section ${i + 1}`,
    center: [(x + spec.roofEdges[i + 1]) / 2, (spec.roofDepth[0] + spec.roofDepth[1]) / 2, (spec.columnTop + spec.roofTop) / 2] as [number, number, number],
    halfSize: [(spec.roofEdges[i + 1] - x) / 2, (spec.roofDepth[1] - spec.roofDepth[0]) / 2, (spec.roofTop - spec.columnTop) / 2] as [number, number, number],
  })),
  {
    id: 'quadriga', name: 'Rooftop sculpture',
    center: spec.sculptureBounds[0].map((v, i) => (v + spec.sculptureBounds[1][i]) / 2) as [number, number, number],
    halfSize: spec.sculptureBounds[0].map((v, i) => (spec.sculptureBounds[1][i] - v) / 2) as [number, number, number],
  },
];

export function gatePartIndex(p: readonly number[]): number {
  if (p.length !== 3 || p.some((v, i) => !Number.isFinite(v) || v < spec.assignmentBounds[0][i] || v > spec.assignmentBounds[1][i])) return -1;
  if (p[2] >= spec.roofTop && p[0] >= spec.sculptureBounds[0][0] && p[0] <= spec.sculptureBounds[1][0]) return 12;
  if (p[2] >= spec.columnTop) return 6 + Math.min(5, spec.roofEdges.slice(1).filter(x => p[0] >= x).length);
  let closest = 0;
  for (let i = 1; i < spec.columnX.length; i++) {
    if (Math.abs(p[0] - spec.columnX[i]) < Math.abs(p[0] - spec.columnX[closest])) closest = i;
  }
  return closest;
}

const gl = (n: number) => n.toFixed(9);
const vector = (v: number[]) => `vec3(${v.map(gl).join(',')})`;
export const gateModifier = `
uniform vec4 partRotations[13];
uniform vec3 partOffsets[13];
vec3 partRotate(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
int gatePart(vec3 p) {
  if (any(lessThan(p, ${vector(spec.assignmentBounds[0])})) || any(greaterThan(p, ${vector(spec.assignmentBounds[1])}))) return -1;
  if (p.z >= ${gl(spec.roofTop)} && p.x >= ${gl(spec.sculptureBounds[0][0])} && p.x <= ${gl(spec.sculptureBounds[1][0])}) return 12;
  if (p.z >= ${gl(spec.columnTop)}) {
    ${spec.roofEdges.slice(1, -1).map((x, i) => `if (p.x < ${gl(x)}) return ${6 + i};`).join('\n')}
    return 11;
  }
  int id = 0;
  float d = abs(p.x - ${gl(spec.columnX[0])});
  ${spec.columnX.slice(1).map((x, i) => `if (abs(p.x - ${gl(x)}) < d) { id = ${i + 1}; d = abs(p.x - ${gl(x)}); }`).join('\n')}
  return id;
}
void modifySplatCenter(inout vec3 center) {
  int id = gatePart(center);
  if (id >= 0) center = partRotate(partRotations[id], center) + partOffsets[id];
}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
  int id = gatePart(originalCenter);
  if (id >= 0) {
    vec4 q = partRotations[id];
    rotation = vec4(q.w * rotation.xyz + rotation.w * q.xyz + cross(q.xyz, rotation.xyz), q.w * rotation.w - dot(q.xyz, rotation.xyz));
    rotation = normalize(rotation);
    if (rotation.w < 0.0) rotation = -rotation;
  }
}
void modifySplatColor(vec3 center, inout vec4 color) {}
`;

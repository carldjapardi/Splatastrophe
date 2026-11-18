import RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyState,
  ConnectionState,
  ImpactBodySpec,
  ImpactConnectionSpec,
  ImpactController,
  ImpactResult,
  ImpactSpec,
  Vec3,
} from './types';

let rapierReady: Promise<void> | null = null;

function ensureRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

interface BodyRecord {
  spec: ImpactBodySpec;
  body: RAPIER.RigidBody;
}

interface ConnectionRecord {
  spec: ImpactConnectionSpec;
  joint: RAPIER.ImpulseJoint | null;
}

/**
 * Block tower driven by Rapier. Joints are the fixture's predefined connections.
 * This is a rigid-body toy: breaking compares the impulse `impact()` applied,
 * not a stress or fracture solve.
 */
export async function createImpactController(spec: ImpactSpec): Promise<ImpactController> {
  await ensureRapier();
  validate(spec);
  const world = new RAPIER.World({ x: spec.gravity[0], y: spec.gravity[1], z: spec.gravity[2] });
  world.timestep = spec.fixedTimestep;

  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.2, 40).setFriction(spec.friction), groundBody);

  const bodies = new Map<string, BodyRecord>();
  for (const bodySpec of spec.bodies) {
    const [hx, hy, hz] = bodySpec.halfExtents;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(bodySpec.position[0], bodySpec.position[1], bodySpec.position[2])
        .setRotation(quat(bodySpec.rotation))
        .setLinearDamping(spec.linearDamping)
        .setAngularDamping(spec.angularDamping)
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(spec.friction)
        .setRestitution(spec.restitution)
        .setDensity(spec.density),
      body,
    );
    bodies.set(bodySpec.id, { spec: bodySpec, body });
  }

  const connections: ConnectionRecord[] = spec.connections.map((connection) => ({
    spec: connection,
    joint: null,
  }));

  let disposed = false;
  let accumulator = 0;

  function spawnJoint(record: ConnectionRecord) {
    const a = bodies.get(record.spec.bodyA);
    const b = bodies.get(record.spec.bodyB);
    if (!a || !b) throw new Error(`connection ${record.spec.id} references a missing body`);
    const joint = world.createImpulseJoint(
      RAPIER.JointData.fixed(
        vec(record.spec.anchorA),
        { x: 0, y: 0, z: 0, w: 1 },
        vec(record.spec.anchorB),
        { x: 0, y: 0, z: 0, w: 1 },
      ),
      a.body,
      b.body,
      true,
    );
    joint.setContactsEnabled(false);
    record.joint = joint;
  }

  for (const connection of connections) spawnJoint(connection);

  function pose(record: BodyRecord): BodyState {
    const translation = record.body.translation();
    const rotation = record.body.rotation();
    return {
      id: record.spec.id,
      position: [translation.x, translation.y, translation.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    };
  }

  const controller: ImpactController = {
    get disposed() {
      return disposed;
    },
    impact(point: Vec3, direction: Vec3, strength: number): ImpactResult {
      if (disposed) throw new Error('ImpactController is disposed');
      const unit = normalize(direction);
      const magnitude = clamp(strength, 0, 2) * spec.maxImpulse;
      const applied: ImpactResult['applied'] = [];
      if (magnitude <= 0 || (unit[0] === 0 && unit[1] === 0 && unit[2] === 0)) {
        return { applied, broken: [] };
      }
      const delivered = new Map<string, number>();
      for (const record of bodies.values()) {
        const center = record.body.translation();
        const distance = Math.hypot(center.x - point[0], center.y - point[1], center.z - point[2]);
        if (distance > spec.influenceRadius) continue;
        const falloff = 1 - distance / spec.influenceRadius;
        const impulse = magnitude * falloff;
        record.body.applyImpulseAtPoint(
          { x: unit[0] * impulse, y: unit[1] * impulse, z: unit[2] * impulse },
          { x: point[0], y: point[1], z: point[2] },
          true,
        );
        delivered.set(record.spec.id, impulse);
        applied.push({ bodyId: record.spec.id, impulse });
      }
      const broken: string[] = [];
      for (const connection of connections) {
        if (!connection.joint) continue;
        const impulse = Math.max(
          delivered.get(connection.spec.bodyA) ?? 0,
          delivered.get(connection.spec.bodyB) ?? 0,
        );
        if (impulse < connection.spec.breakImpulse) continue;
        world.removeImpulseJoint(connection.joint, true);
        connection.joint = null;
        broken.push(connection.spec.id);
      }
      return { applied, broken };
    },
    update(dt: number) {
      if (disposed) return;
      const step = spec.fixedTimestep;
      accumulator += Math.min(Number.isFinite(dt) ? Math.max(0, dt) : 0, 0.05);
      let guard = 0;
      while (accumulator >= step && guard < 4) {
        world.timestep = step;
        world.step();
        accumulator -= step;
        guard += 1;
      }
      if (guard === 4) accumulator = 0;
    },
    reset() {
      if (disposed) throw new Error('ImpactController is disposed');
      accumulator = 0;
      for (const record of bodies.values()) {
        const [x, y, z] = record.spec.position;
        const [qx, qy, qz, qw] = record.spec.rotation;
        record.body.setTranslation({ x, y, z }, true);
        record.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
        record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        record.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      for (const connection of connections) {
        if (connection.joint) {
          world.removeImpulseJoint(connection.joint, true);
          connection.joint = null;
        }
        spawnJoint(connection);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      world.free();
    },
    getBodies() {
      if (disposed) throw new Error('ImpactController is disposed');
      return [...bodies.values()].map(pose);
    },
    getConnections() {
      if (disposed) throw new Error('ImpactController is disposed');
      return connections.map((connection): ConnectionState => ({
        id: connection.spec.id,
        bodyA: connection.spec.bodyA,
        bodyB: connection.spec.bodyB,
        intact: connection.joint !== null,
        breakImpulse: connection.spec.breakImpulse,
      }));
    },
  };

  return controller;
}

export function parseImpactFixture(data: unknown): ImpactSpec {
  const root = asRecord(data, 'fixture');
  const impact = asRecord(root.impact, 'impact');
  const bodies = asArray(impact.bodies, 'impact.bodies').map((entry, index) => parseBody(entry, index));
  const connections = asArray(impact.connections, 'impact.connections').map((entry, index) => parseConnection(entry, index));
  const spec: ImpactSpec = {
    id: typeof root.id === 'string' ? root.id : 'synthetic-tower',
    gravity: vec3(impact.gravity, 'impact.gravity'),
    maxImpulse: positive(impact.maxImpulse, 'impact.maxImpulse'),
    influenceRadius: positive(impact.influenceRadius, 'impact.influenceRadius'),
    density: positive(impact.density, 'impact.density'),
    friction: nonNegative(impact.friction, 'impact.friction'),
    restitution: nonNegative(impact.restitution, 'impact.restitution'),
    linearDamping: nonNegative(impact.linearDamping, 'impact.linearDamping'),
    angularDamping: nonNegative(impact.angularDamping, 'impact.angularDamping'),
    fixedTimestep: positive(impact.fixedTimestep, 'impact.fixedTimestep'),
    bodies,
    connections,
  };
  validate(spec);
  return spec;
}

function validate(spec: ImpactSpec) {
  if (spec.bodies.length === 0) throw new Error('impact fixture needs at least one body');
  const ids = new Set<string>();
  for (const body of spec.bodies) {
    if (ids.has(body.id)) throw new Error(`duplicate body id ${body.id}`);
    ids.add(body.id);
    if (body.halfExtents.some((value) => value <= 0)) throw new Error(`body ${body.id} has a non-positive extent`);
    const q = Math.hypot(body.rotation[0], body.rotation[1], body.rotation[2], body.rotation[3]);
    if (Math.abs(q - 1) > 1e-3) throw new Error(`body ${body.id} rotation must be a unit quaternion [x, y, z, w]`);
  }
  const jointIds = new Set<string>();
  for (const connection of spec.connections) {
    if (jointIds.has(connection.id)) throw new Error(`duplicate connection id ${connection.id}`);
    jointIds.add(connection.id);
    if (!ids.has(connection.bodyA) || !ids.has(connection.bodyB)) {
      throw new Error(`connection ${connection.id} references a missing body`);
    }
    if (connection.breakImpulse <= 0) throw new Error(`connection ${connection.id} breakImpulse must be positive`);
  }
}

function parseBody(value: unknown, index: number): ImpactBodySpec {
  const body = asRecord(value, `bodies[${index}]`);
  if (typeof body.id !== 'string' || body.id.length === 0) throw new Error(`bodies[${index}].id is required`);
  return {
    id: body.id,
    halfExtents: vec3(body.halfExtents, `${body.id}.halfExtents`),
    position: vec3(body.position, `${body.id}.position`),
    rotation: quat4(body.rotation, `${body.id}.rotation`),
  };
}

function parseConnection(value: unknown, index: number): ImpactConnectionSpec {
  const connection = asRecord(value, `connections[${index}]`);
  if (typeof connection.id !== 'string' || connection.id.length === 0) {
    throw new Error(`connections[${index}].id is required`);
  }
  if (typeof connection.bodyA !== 'string' || typeof connection.bodyB !== 'string') {
    throw new Error(`connection ${connection.id} needs bodyA and bodyB`);
  }
  return {
    id: connection.id,
    bodyA: connection.bodyA,
    bodyB: connection.bodyB,
    anchorA: vec3(connection.anchorA, `${connection.id}.anchorA`),
    anchorB: vec3(connection.anchorB, `${connection.id}.anchorB`),
    breakImpulse: positive(connection.breakImpulse, `${connection.id}.breakImpulse`),
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function vec3(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error(`${label} must be a finite [x, y, z]`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function quat4(value: unknown, label: string): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error(`${label} must be a finite quaternion [x, y, z, w]`);
  }
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number];
}

function positive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function nonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function length(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value: Vec3): [number, number, number] {
  const len = length(value);
  if (len < 1e-8) return [0, 0, 0];
  return [value[0] / len, value[1] / len, value[2] / len];
}

function vec(value: Vec3): { x: number; y: number; z: number } {
  return { x: value[0], y: value[1], z: value[2] };
}

function quat(value: readonly [number, number, number, number]): { x: number; y: number; z: number; w: number } {
  return { x: value[0], y: value[1], z: value[2], w: value[3] };
}

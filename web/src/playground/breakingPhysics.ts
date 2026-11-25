import RAPIER from '@dimforge/rapier3d-compat';

export interface BreakingPart {
  id: string;
  name: string;
  center: [number, number, number];
  halfSize: [number, number, number];
}

export interface BreakingPose {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface BreakingPhysics {
  getPoses(): BreakingPose[];
  breakPart(index: number, strength: number): void;
  collapse(): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
  getBrokenCount(): number;
}

const STEP = 1 / 120;
const TOUCH_TOLERANCE = 1e-5;
const DENSITY = 2200;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
let rapierReady: Promise<void> | undefined;

export async function createBreakingPhysics(
  parts: readonly BreakingPart[],
  options: { groundZ: number; metersPerUnit: number },
): Promise<BreakingPhysics> {
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('At least one breaking part is required');
  if (!options || !Number.isFinite(options.groundZ)) throw new Error('groundZ must be finite');
  if (!Number.isFinite(options.metersPerUnit) || options.metersPerUnit <= 0) {
    throw new Error('metersPerUnit must be finite and positive');
  }
  const { groundZ, metersPerUnit: scale } = options;
  if (!Number.isFinite(Math.fround(groundZ * scale))) throw new Error('Scaled groundZ is out of range');
  const ids = new Set<string>();
  const original = parts.map((part: BreakingPart): BreakingPart => {
    if (!part || typeof part.id !== 'string' || !part.id.trim()) throw new Error('Part id is required');
    if (ids.has(part.id)) throw new Error(`Duplicate part id: ${part.id}`);
    ids.add(part.id);
    if (typeof part.name !== 'string' || !part.name.trim()) throw new Error('Part name is required');
    for (const key of ['center', 'halfSize'] as const) {
      const value = part[key];
      if (!Array.isArray(value) || value.length !== 3 || ![0, 1, 2].every(axis => Number.isFinite(value[axis]))) {
        throw new Error(`${part.id}.${key} must be a finite [x, y, z]`);
      }
      if (value.some(v => !Number.isFinite(Math.fround(v * scale)))) throw new Error(`Scaled ${key} is out of range`);
    }
    if (part.halfSize.some(v => v <= 0 || Math.fround(v * scale) <= 0)) throw new Error('halfSize must be positive');
    const [hx, hy, hz] = part.halfSize.map(v => v * scale);
    const mass = DENSITY * 8 * hx * hy * hz;
    if (![mass, mass * (hy * hy + hz * hz) / 3, mass * (hx * hx + hz * hz) / 3,
      mass * (hx * hx + hy * hy) / 3].every(v => Number.isFinite(Math.fround(v)) && Math.fround(v) > 0)) {
      throw new Error('Scaled mass or inertia is out of range');
    }
    return { id: part.id, name: part.name, center: [...part.center], halfSize: [...part.halfSize] };
  });

  const attachments: { a: number; b: number }[] = [];
  for (let a = 0; a < original.length; a++) {
    const first = original[a];
    if (Math.abs(first.center[2] - first.halfSize[2] - groundZ) <= TOUCH_TOLERANCE) {
      attachments.push({ a, b: -1 });
    }
    for (let b = a + 1; b < original.length; b++) {
      const second = original[b];
      if ([0, 1, 2].some(axis => {
        const separation = Math.abs(first.center[axis] - second.center[axis]);
        if (Math.abs(separation - first.halfSize[axis] - second.halfSize[axis]) > TOUCH_TOLERANCE) return false;
        return [0, 1, 2].every(other => other === axis ||
          Math.min(first.center[other] + first.halfSize[other], second.center[other] + second.halfSize[other]) >
          Math.max(first.center[other] - first.halfSize[other], second.center[other] - second.halfSize[other]));
      })) attachments.push({ a, b });
    }
  }

  await (rapierReady ??= RAPIER.init().catch(error => {
    rapierReady = undefined;
    throw error;
  }));
  let world: RAPIER.World;
  let bodies: RAPIER.RigidBody[];
  let joints: { a: number; b: number; joint: RAPIER.ImpulseJoint }[];
  let accumulator = 0;
  let stepped = false;
  let disposed = false;
  const broken = new Set<number>();

  function build() {
    world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    world.timestep = STEP;
    world.numSolverIterations = 12;
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, groundZ * scale));
    world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 0, z: 1 })).setFriction(0.7), ground);
    bodies = original.map(part => {
      const [x, y, z] = part.center.map(v => v * scale);
      const [hx, hy, hz] = part.halfSize.map(v => v * scale);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setDensity(DENSITY).setFriction(0.7).setRestitution(0), body);
      body.recomputeMassPropertiesFromColliders();
      return body;
    });
    joints = attachments.map(({ a, b }) => {
      const first = original[a].center;
      const second = b < 0 ? [0, 0, groundZ] : original[b].center;
      const offset = first.map((v, axis) => (v - second[axis]) * scale);
      const joint = world.createImpulseJoint(RAPIER.JointData.fixed(
        { x: 0, y: 0, z: 0 }, IDENTITY,
        { x: offset[0], y: offset[1], z: offset[2] }, IDENTITY,
      ), bodies[a], b < 0 ? ground : bodies[b], true);
      joint.setContactsEnabled(false);
      return { a, b, joint };
    });
  }

  function assertActive() {
    if (disposed) throw new Error('BreakingPhysics is disposed');
  }

  build();
  return {
    getPoses() {
      assertActive();
      return bodies.map((body, index): BreakingPose => {
        if (!stepped) return { position: [...original[index].center], rotation: [0, 0, 0, 1] };
        const p = body.translation();
        const q = body.rotation();
        return { position: [p.x / scale, p.y / scale, p.z / scale], rotation: [q.x, q.y, q.z, q.w] };
      });
    },
    breakPart(index, strength) {
      assertActive();
      if (!Number.isInteger(index) || index < 0 || index >= bodies.length) throw new Error('Part index is out of range');
      if (!Number.isFinite(strength)) throw new Error('Strength must be finite');
      const amount = Math.min(1, Math.max(0, strength));
      joints = joints.filter(record => {
        if (record.a !== index && record.b !== index) return true;
        world.removeImpulseJoint(record.joint, true);
        return false;
      });
      broken.add(index);
      const body = bodies[index];
      const impulse = body.mass() * 3 * amount;
      const [hx, hy, hz] = original[index].halfSize.map(v => v * scale);
      if (hx < hy) {
        const middleX = original.reduce((sum, part) => sum + part.center[0], 0) / original.length;
        const direction = original[index].center[0] < middleX ? -1 : 1;
        body.applyImpulse({ x: direction * body.mass() * 2 * Math.sqrt(2 * 9.81 * 2 * hx) * amount, y: 0, z: 0 }, true);
        body.applyTorqueImpulse({ x: 0, y: direction * body.mass() * (hx * hx + hz * hz) / 3 * 0.12 * amount, z: 0 }, true);
      } else {
        body.applyImpulse({ x: 0, y: -impulse, z: 0 }, true);
        body.applyTorqueImpulse({ x: body.mass() * (hy * hy + hz * hz) / 3 * 1.2 * amount, y: 0, z: 0 }, true);
      }
    },
    collapse() {
      assertActive();
      for (const record of joints) world.removeImpulseJoint(record.joint, true);
      joints = [];
      bodies.forEach((body, index) => {
        if (!broken.has(index)) body.applyImpulse({ x: (index % 2 ? 1 : -1) * body.mass() * 0.15, y: -body.mass() * 0.2, z: 0 }, true);
        broken.add(index);
      });
    },
    update(dt) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return;
      accumulator += Math.min(dt, 0.1);
      while (accumulator + 1e-12 >= STEP) {
        world.step();
        stepped = true;
        accumulator = Math.max(0, accumulator - STEP);
      }
    },
    reset() {
      assertActive();
      world.free();
      accumulator = 0;
      stepped = false;
      broken.clear();
      build();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      world.free();
      bodies = [];
      joints = [];
      broken.clear();
    },
    getBrokenCount() {
      assertActive();
      return broken.size;
    },
  };
}

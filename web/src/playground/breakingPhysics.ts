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
const UNLOAD_MIN_STEPS = 30;
const TOPPLE_STRENGTH = 0.4;
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
  // supportersOf[i]: parts whose top face carries part i, or -1 for the ground.
  const supportersOf: number[][] = original.map(() => []);
  const restsOn = (upper: BreakingPart, lower: BreakingPart) =>
    Math.abs(upper.center[2] - upper.halfSize[2] - lower.center[2] - lower.halfSize[2]) <= TOUCH_TOLERANCE;
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
      })) {
        attachments.push({ a, b });
        if (restsOn(first, second)) supportersOf[a].push(b);
        if (restsOn(second, first)) supportersOf[b].push(a);
      }
    }
  }
  attachments.forEach(({ a, b }) => { if (b < 0) supportersOf[a].push(-1); });

  await (rapierReady ??= RAPIER.init().catch(error => {
    rapierReady = undefined;
    throw error;
  }));
  let world: RAPIER.World;
  let bodies: RAPIER.RigidBody[];
  let joints: { a: number; b: number; joint: RAPIER.ImpulseJoint }[];
  let colliders: RAPIER.Collider[];
  // A broken support stops carrying the parts it held: solver contact between them is off until they separate.
  let unloaded: { support: number; part: number; steps: number }[] = [];
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
    colliders = bodies.map(body => body.collider(0));
    unloaded = [];
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

  // Solver groups: (membership << 16) | filter. A carried part's membership is the support's bit, and the support's
  // filter drops that bit, so the pair still collides with everything else but not with each other.
  function applySolverGroups() {
    colliders.forEach(collider => collider.setSolverGroups(0xffffffff));
    for (const { support, part } of unloaded) {
      const bit = 1 << (support % 16);
      const own = colliders[support].solverGroups();
      colliders[support].setSolverGroups(own & ~bit);
      colliders[part].setSolverGroups((bit << 16) | 0xffff);
    }
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
      const release = (part: number) => {
        joints = joints.filter(record => {
          if (record.a !== part && record.b !== part) return true;
          world.removeImpulseJoint(record.joint, true);
          return false;
        });
        broken.add(part);
      };
      release(index);
      const carried = new Set<number>();
      // A part that rested only on released parts has lost its support. Its remaining side joints are mortar that
      // would have to carry it as a cantilever, so release it too and let gravity take it (repeat up the stack).
      for (let changed = true; changed;) {
        changed = false;
        original.forEach((_, part) => {
          if (broken.has(part) || supportersOf[part].length === 0) return;
          if (supportersOf[part].every(below => below >= 0 && broken.has(below))) {
            release(part);
            if (supportersOf[part].includes(index)) carried.add(part);
            changed = true;
          }
        });
      }
      const body = bodies[index];
      const impulse = body.mass() * 3 * amount;
      const [hx, hy, hz] = original[index].halfSize.map(v => v * scale);
      // A push strong enough to topple a tall part counts as that part failing: it stops carrying the parts it held,
      // so they drop instead of riding it over. Weaker pushes leave it carrying them.
      if (hx < hy && hz > hx && amount >= TOPPLE_STRENGTH) {
        for (const part of carried) unloaded.push({ support: index, part, steps: 0 });
        applySolverGroups();
      }
      if (hx < hy) {
        const middleX = original.reduce((sum, part) => sum + part.center[0], 0) / original.length;
        const direction = original[index].center[0] < middleX ? -1 : 1;
        if (hz > hx) {
          // Tall part: push its top so it tips about its front base edge, toward the default camera (-y). It no longer
          // carries what it held up, so in-plane neighbours can't wedge it. The push is sized from the energy needed to
          // lift the centre of mass over that edge, (R - h/2)·m·g with R = ½√(d² + h²) and pivot inertia m(d² + h²)/3,
          // times 0.7 + strength for any push: about 0.4 and up topples it (1.2× at the default 0.5), weaker pushes rock
          // it back, and 0 only releases it.
          const d = 2 * hy, h = 2 * hz;
          const pivotInertia = (d * d + h * h) / 3;
          const tipRate = Math.sqrt(2 * 9.81 * (Math.hypot(d, h) / 2 - h / 2) / pivotInertia);
          const top = body.translation();
          body.applyImpulseAtPoint({ x: 0, y: -body.mass() * pivotInertia * tipRate * (amount > 0 ? 0.7 + amount : 0) / h, z: 0 },
            { x: top.x, y: top.y, z: top.z + hz }, true);
        } else {
          body.applyImpulse({ x: direction * body.mass() * 2 * Math.sqrt(2 * 9.81 * 2 * hx) * amount, y: 0, z: 0 }, true);
        }
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
        if (unloaded.length) {
          const before = unloaded.length;
          unloaded = unloaded.filter(pair => {
            pair.steps++;
            if (pair.steps < UNLOAD_MIN_STEPS) return true;
            let touching = false;
            world.contactPair(colliders[pair.support], colliders[pair.part], manifold => {
              if (manifold.numContacts() > 0) touching = true;
            });
            return touching;
          });
          if (unloaded.length !== before) applySolverGroups();
        }
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

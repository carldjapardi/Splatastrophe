import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBreakingPhysics, type BreakingPart, type BreakingPhysics } from '../src/playground/breakingPhysics';
import { gateParts, gateSpec } from '../src/playground/gateParts';

const controllers: BreakingPhysics[] = [];
const parts: BreakingPart[] = [
  { id: 'support', name: 'Support', center: [0, 0, 1], halfSize: [0.5, 0.5, 1] },
  { id: 'overhang', name: 'Overhang', center: [1, 0, 1.5], halfSize: [0.5, 0.5, 0.5] },
  { id: 'upper', name: 'Upper block', center: [0, 0, 2.5], halfSize: [0.5, 0.5, 0.5] },
];

async function create(input = parts, options = { groundZ: 0, metersPerUnit: 1 }) {
  const controller = await createBreakingPhysics(input, options);
  controllers.push(controller);
  return controller;
}

function advance(controller: BreakingPhysics, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 120); i++) controller.update(1 / 120);
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe('Z-up breaking physics', () => {
  it('holds grounded supports and a face-attached cantilever at rest', async () => {
    const controller = await create();
    advance(controller, 2);
    for (const [index, pose] of controller.getPoses().entries()) {
      pose.position.forEach((value, axis) => expect(value).toBeCloseTo(parts[index].center[axis], 3));
      pose.rotation.forEach((value, axis) => expect(value).toBeCloseTo(axis === 3 ? 1 : 0, 3));
    }
    expect(controller.getBrokenCount()).toBe(0);
  });

  it('detaches only the selected part and lets its unsupported mass fall', async () => {
    const controller = await create();
    controller.breakPart(1, 0);
    advance(controller, 0.3);
    expect(controller.getPoses()[1].position[2]).toBeLessThan(1.2);
    expect(controller.getPoses()[0].position[2]).toBeCloseTo(1, 3);
    expect(controller.getPoses()[2].position[2]).toBeCloseTo(2.5, 3);
    expect(controller.getBrokenCount()).toBe(1);
    controller.breakPart(1, 0.5);
    expect(controller.getBrokenCount()).toBe(1);
    controller.breakPart(2, 0.5);
    expect(controller.getBrokenCount()).toBe(2);
  });

  it('releases incident joints and ground anchors when a support is broken', async () => {
    const controller = await create([{ ...parts[0], halfSize: [0.5, 0.1, 1] }, ...parts.slice(1)]);
    controller.breakPart(0, 1);
    advance(controller, 0.7);
    const poses = controller.getPoses();
    expect(poses[0].position[1]).toBeLessThan(-0.3);
    expect(Math.abs(poses[0].rotation[0])).toBeGreaterThan(0.01);
    expect(poses[1].position[2]).toBeLessThan(1);
    expect(poses[2].position[2]).toBeLessThan(2.4);
    // The upper block rested only on the support, so it is released with it.
    expect(controller.getBrokenCount()).toBe(2);
  });

  it('collapses every part, preserves ground collisions, and counts unique parts', async () => {
    const controller = await create();
    controller.breakPart(1, 1);
    controller.collapse();
    controller.collapse();
    expect(controller.getBrokenCount()).toBe(parts.length);
    advance(controller, 3);
    expect(controller.getPoses()[1].position[2]).toBeLessThan(1);
    for (const pose of controller.getPoses()) {
      expect(pose.position[2]).toBeGreaterThan(0.45);
      expect(Math.hypot(...pose.rotation)).toBeCloseTo(1, 4);
      expect(pose.position.every(Number.isFinite)).toBe(true);
    }
  });

  it('returns exact original poses and resets velocities, joints, and timestep debt', async () => {
    const fixture: BreakingPart[] = parts.map(part => ({ ...part,
      center: part.center.map(v => v * 0.123456789) as BreakingPart['center'],
      halfSize: part.halfSize.map(v => v * 0.123456789) as BreakingPart['halfSize'],
    }));
    const options = { groundZ: 0, metersPerUnit: 8.10000007371 };
    const controller = await create(fixture, options);
    const fresh = await create(fixture, options);
    const initial = controller.getPoses();
    controller.collapse();
    advance(controller, 1);
    controller.update(1 / 240);
    controller.reset();
    expect(controller.getPoses()).toEqual(initial);
    expect(controller.getBrokenCount()).toBe(0);
    controller.update(1 / 240);
    fresh.update(1 / 240);
    expect(controller.getPoses()).toEqual(initial);
    controller.breakPart(1, 0);
    fresh.breakPart(1, 0);
    advance(controller, 0.5);
    advance(fresh, 0.5);
    expect(controller.getPoses()).toEqual(fresh.getPoses());
    controller.reset();
    controller.reset();
    expect(controller.getPoses()).toEqual(initial);
  });

  it('uses meters for gravity and mass-scaled impulses, independent of viewer scale', async () => {
    const fixture: BreakingPart[] = [{ id: 'free', name: 'Free', center: [0, 0, 10], halfSize: [0.5, 0.5, 0.5] }];
    const meters = await create(fixture);
    const viewer = await create(fixture.map(part => ({ ...part,
      center: part.center.map(v => v / 100) as BreakingPart['center'],
      halfSize: part.halfSize.map(v => v / 100) as BreakingPart['halfSize'],
    })), { groundZ: 0, metersPerUnit: 100 });
    meters.breakPart(0, 0.5);
    viewer.breakPart(0, 0.5);
    advance(meters, 0.25);
    advance(viewer, 0.25);
    const a = meters.getPoses()[0];
    const b = viewer.getPoses()[0];
    a.position.forEach((v, axis) => expect(b.position[axis] * 100).toBeCloseTo(v, 5));
    expect(a.position[2]).toBeCloseTo(10 - 0.5 * 9.81 * 0.25 ** 2, 1);
    expect(a.position[1]).toBeCloseTo(-1.5 * 0.25, 3);
    expect(a.rotation).toEqual(b.rotation);
  });

  it('does not attach across a gap, at an edge, or between overlapping volumes', async () => {
    for (const center of [[1.00002, 0, 1.5], [1, 1, 1.5], [0.9, 0, 1.5]] as [number, number, number][]) {
      const controller = await create([parts[0], { ...parts[1], center }]);
      advance(controller, 0.3);
      expect(controller.getPoses()[1].position[2]).toBeLessThan(1.3);
    }
  });

  it('attaches within the viewer-unit tolerance but never anchors an elevated bottom', async () => {
    const attached = await create([parts[0], { ...parts[1], center: [1.000005, 0, 1.5] }]);
    advance(attached, 0.3);
    expect(attached.getPoses()[1].position[2]).toBeCloseTo(1.5, 3);
    const floating = await create([{ ...parts[1], center: [0, 0, 1] }]);
    advance(floating, 0.2);
    expect(floating.getPoses()[0].position[2]).toBeLessThan(0.85);
    const offset = await create([{ ...parts[0], center: [0, 0, -4] }], { groundZ: -5, metersPerUnit: 2 });
    advance(offset, 0.5);
    expect(offset.getPoses()[0].position[2]).toBeCloseTo(-4, 3);
  });

  it('is deterministic across frame partitions and caps or ignores invalid elapsed time', async () => {
    const a = await create();
    const b = await create();
    a.collapse();
    b.collapse();
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    advance(b, 1);
    expect(a.getPoses()).toEqual(b.getPoses());
    const before = a.getPoses();
    for (const dt of [NaN, Infinity, -Infinity, -1, 0]) a.update(dt);
    expect(a.getPoses()).toEqual(before);
    a.update(100);
    b.update(0.1);
    expect(a.getPoses()).toEqual(b.getPoses());
  });

  it('clamps strength and validates action inputs without mutating the simulation', async () => {
    const a = await create();
    const b = await create();
    for (const index of [-1, 3, 0.5, NaN, Infinity]) expect(() => a.breakPart(index, 1)).toThrow(/index/);
    for (const strength of [NaN, Infinity, -Infinity]) expect(() => a.breakPart(0, strength)).toThrow(/finite/);
    expect(a.getBrokenCount()).toBe(0);
    a.breakPart(1, 5);
    b.breakPart(1, 1);
    advance(a, 0.2);
    advance(b, 0.2);
    expect(a.getPoses()).toEqual(b.getPoses());
    a.reset();
    b.reset();
    a.breakPart(1, -5);
    b.breakPart(1, 0);
    advance(a, 0.2);
    advance(b, 0.2);
    expect(a.getPoses()).toEqual(b.getPoses());
  });

  it('snapshots caller-owned data and returns independent pose arrays', async () => {
    const input = structuredClone(parts);
    const pending = create(input);
    input[0].center[2] = 100;
    const controller = await pending;
    const poses = controller.getPoses();
    expect(poses[0].position[2]).toBe(1);
    poses[0].position[2] = 200;
    controller.reset();
    expect(controller.getPoses()[0].position[2]).toBe(1);
  });

  it('rejects malformed fixtures and unrepresentable scaled physics', async () => {
    const malformed = [[], [parts[0], parts[0]], [{ ...parts[0], id: '' }], [{ ...parts[0], name: '' }],
      [{ ...parts[0], center: [0, NaN, 1] }], [{ ...parts[0], center: [0, 1] }],
      [{ ...parts[0], halfSize: [0, 1, 1] }], [{ ...parts[0], halfSize: [-1, 1, 1] }],
      [{ ...parts[0], halfSize: [1, Infinity, 1] }], [{ ...parts[0], halfSize: [1e-100, 1, 1] }],
      [{ ...parts[0], center: [1e100, 0, 1] }], [{ ...parts[0], halfSize: [1e20, 1e20, 1e20] }],
    ];
    for (const fixture of malformed) await expect(createBreakingPhysics(fixture as BreakingPart[], { groundZ: 0, metersPerUnit: 1 })).rejects.toThrow();
    for (const metersPerUnit of [0, -1, NaN, Infinity]) {
      await expect(createBreakingPhysics(parts, { groundZ: 0, metersPerUnit })).rejects.toThrow(/metersPerUnit/);
    }
    for (const groundZ of [NaN, Infinity]) {
      await expect(createBreakingPhysics(parts, { groundZ, metersPerUnit: 1 })).rejects.toThrow(/groundZ/);
    }
  });

  it('disposes idempotently, ignores subsequent updates, and rejects other calls', async () => {
    const controller = await create();
    controller.dispose();
    expect(() => controller.dispose()).not.toThrow();
    expect(() => controller.update(1)).not.toThrow();
    expect(() => controller.getPoses()).toThrow(/disposed/);
    expect(() => controller.getBrokenCount()).toThrow(/disposed/);
    expect(() => controller.breakPart(0, 1)).toThrow(/disposed/);
    expect(() => controller.collapse()).toThrow(/disposed/);
    expect(() => controller.reset()).toThrow(/disposed/);
  });

  it('topples a broken gate column toward the camera and drops the roof bay it carried', async () => {
    const meters = (pose: { position: number[] }, index: number) =>
      pose.position.map((v, axis) => (v - gateParts[index].center[axis]) * gateSpec.metersPerUnit);
    const tilt = (q: number[]) => 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180 / Math.PI;
    // Outer column, a middle column under the sculpture, and the other outer column.
    for (const index of [0, 2, 5]) {
      const roof = 6 + index;
      const controller = await create(gateParts, gateSpec);
      controller.breakPart(index, 0.5);
      expect(controller.getBrokenCount()).toBe(2);
      advance(controller, 5);
      const poses = controller.getPoses();
      expect(tilt(poses[index].rotation)).toBeGreaterThan(80);
      expect(meters(poses[index], index)[1]).toBeLessThan(-5);
      expect(meters(poses[roof], roof)[2]).toBeLessThan(-10);
      poses.forEach((pose, other) => {
        if (other !== index && other !== roof) expect(Math.hypot(...meters(pose, other))).toBeLessThan(0.05);
      });
    }
  });

  it('leaves a weakly pushed gate column carrying its released roof bay', async () => {
    const controller = await create(gateParts, gateSpec);
    controller.breakPart(2, 0.2);
    advance(controller, 3);
    expect(controller.getBrokenCount()).toBe(2);
    controller.getPoses().forEach((pose, index) => {
      expect(Math.hypot(...pose.position.map((v, axis) => (v - gateParts[index].center[axis]) * gateSpec.metersPerUnit)))
        .toBeLessThan(0.05);
    });
  });

  it('keeps gravity-supported actual gate parts stable after releasing every joint', async () => {
    const controller = await create(gateParts, gateSpec);
    controller.collapse();
    advance(controller, 3);
    expect(controller.getBrokenCount()).toBe(gateParts.length);
    controller.getPoses().forEach((pose, index) => {
      expect(Math.hypot(...pose.position.map((v, axis) => (v - gateParts[index].center[axis]) * gateSpec.metersPerUnit))).toBeLessThan(0.02);
    });
  });

  it('retries initialization after a shared rejected attempt', async () => {
    vi.resetModules();
    const rapier = await import('@dimforge/rapier3d-compat');
    const init = vi.fn(rapier.default.init).mockRejectedValueOnce(new Error('WASM initialization failed'));
    vi.doMock('@dimforge/rapier3d-compat', () => ({ ...rapier, default: { ...rapier.default, init } }));
    try {
      const { createBreakingPhysics: retry } = await import('../src/playground/breakingPhysics');
      const options = { groundZ: 0, metersPerUnit: 1 };
      const failures = await Promise.allSettled([retry(parts, options), retry(parts, options)]);
      expect(failures.map(result => result.status)).toEqual(['rejected', 'rejected']);
      expect(init).toHaveBeenCalledTimes(1);
      const controller = await retry(parts, options);
      controllers.push(controller);
      expect(init).toHaveBeenCalledTimes(2);
      expect(controller.getPoses()[0].position).toEqual(parts[0].center);
    } finally {
      vi.doUnmock('@dimforge/rapier3d-compat');
      vi.resetModules();
    }
  });
});

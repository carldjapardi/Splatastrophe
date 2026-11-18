import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../fixtures/physics/synthetic-tower.json';
import { createImpactController, parseImpactFixture } from '../src/index';

const spec = parseImpactFixture(fixtureJson);

function topBody() {
  return spec.bodies.reduce((best, body) => (body.position[1] > best.position[1] ? body : best));
}

async function settle(controller: Awaited<ReturnType<typeof createImpactController>>, seconds: number) {
  const steps = Math.round(seconds / spec.fixedTimestep);
  for (let i = 0; i < steps; i += 1) controller.update(spec.fixedTimestep);
}

describe('synthetic tower impact', () => {
  it('parses the predefined block tower and its breakable joints', () => {
    expect(spec.bodies).toHaveLength(24);
    expect(spec.connections.length).toBeGreaterThan(20);
    expect(spec.gravity[1]).toBeLessThan(0);
    const ids = new Set(spec.bodies.map((body) => body.id));
    for (const connection of spec.connections) {
      expect(ids.has(connection.bodyA)).toBe(true);
      expect(ids.has(connection.bodyB)).toBe(true);
    }
  });

  it('holds the stack, ignores a weak hit, and breaks joints on a strong hit', async () => {
    const controller = await createImpactController(spec);
    await settle(controller, 0.5);
    const rested = controller.getBodies();
    for (const body of rested) {
      const home = spec.bodies.find((entry) => entry.id === body.id)!;
      expect(Math.abs(body.position[1] - home.position[1])).toBeLessThan(0.05);
    }
    expect(controller.getConnections().every((connection) => connection.intact)).toBe(true);

    const target = topBody();
    const weak = controller.impact(target.position, [1, 0.1, 0], 0.01);
    expect(weak.broken).toHaveLength(0);
    expect(controller.getConnections().every((connection) => connection.intact)).toBe(true);

    controller.reset();
    const strong = controller.impact(target.position, [1, 0.15, 0], 1);
    expect(strong.applied.some((hit) => hit.bodyId === target.id)).toBe(true);
    expect(strong.broken.length).toBeGreaterThan(0);
    expect(strong.broken.every((id) => id.includes(target.id) || controller.getConnections().some((connection) => connection.id === id && !connection.intact))).toBe(true);

    await settle(controller, 2.5);
    const after = controller.getBodies();
    for (const body of after) {
      expect(body.position[1]).toBeGreaterThan(0.2);
      expect(Math.hypot(...body.rotation)).toBeCloseTo(1, 4);
    }
    const traveled = after.some((body) => {
      const home = spec.bodies.find((entry) => entry.id === body.id)!;
      return Math.hypot(body.position[0] - home.position[0], body.position[2] - home.position[2]) > 0.25
        || Math.abs(body.position[1] - home.position[1]) > 0.25;
    });
    expect(traveled).toBe(true);

    controller.reset();
    expect(controller.getConnections().every((connection) => connection.intact)).toBe(true);
    for (const body of controller.getBodies()) {
      const home = spec.bodies.find((entry) => entry.id === body.id)!;
      expect(body.position[0]).toBeCloseTo(home.position[0], 4);
      expect(body.position[1]).toBeCloseTo(home.position[1], 4);
      expect(body.position[2]).toBeCloseTo(home.position[2], 4);
    }
    controller.dispose();
  });
});

import { expect, it } from 'vitest';
import { createBreakingPhysics } from '../src/playground/breakingPhysics';
import { gateParts, gateSpec } from '../src/playground/gateParts';

it('drops roof sections after releasing and pushing away their supports', async () => {
  const physics = await createBreakingPhysics(gateParts, gateSpec);
  try {
    physics.collapse();
    gateParts.forEach((_, i) => physics.breakPart(i, 0.5));
    for (let i = 0; i < 120 * 5; i++) physics.update(1 / 120);
    const poses = physics.getPoses();
    expect(physics.getBrokenCount()).toBe(13);
    expect(poses.slice(6, 12).filter((p, i) => p.position[2] < gateParts[i + 6].center[2] - .02).length).toBeGreaterThanOrEqual(3);
    physics.reset();
    expect(physics.getPoses().map(p => p.position)).toEqual(gateParts.map(p => p.center));
  } finally {
    physics.dispose();
  }
});

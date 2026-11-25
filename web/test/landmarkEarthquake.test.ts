import { BoundingBox, Vec3 } from 'playcanvas';
import type { Application, GSplatComponent } from 'playcanvas';
import { afterEach, expect, it, vi } from 'vitest';
import { createLandmarkEarthquake, earthquakeDuration } from '../src/playground/landmarkEarthquake';
import { bindBuildingMotion } from '../src/playground/landmarkMotion';
import type { LandmarkMotionSpec } from '../src/playground/catalog';

const motion: LandmarkMotionSpec = { base: [0, 0, 0], halfWidth: 2, halfDepth: 1, bounceHeight: .4 };

afterEach(() => vi.unstubAllGlobals());

it('sets up the shader in world coordinates and restores the original splats on reset', () => {
  const splats = { customAabb: null, setParameter: vi.fn(), setWorkBufferModifier: vi.fn() };
  const bounds = new BoundingBox(new Vec3(0, -2, 0), new Vec3(2, 2, 1));
  const earthquake = createLandmarkEarthquake(splats as unknown as GSplatComponent, bounds, -90, motion);

  expect(splats.setParameter).toHaveBeenCalledWith('uQuakeBaseHeight', new Float32Array([0, 0, 0, 4]));
  earthquake.reset();
  expect(splats.setWorkBufferModifier).not.toHaveBeenCalled();

  earthquake.start();
  expect(splats.customAabb).toBeInstanceOf(BoundingBox);
  expect(splats.setWorkBufferModifier).toHaveBeenLastCalledWith({ glsl: expect.stringContaining('modifySplatCenter') });
  earthquake.update(earthquakeDuration + 1);
  expect(splats.setParameter).toHaveBeenLastCalledWith('uQuakeTime', earthquakeDuration);
  earthquake.reset();
  expect(splats.customAabb).toBeNull();
  expect(splats.setWorkBufferModifier).toHaveBeenLastCalledWith(null);
  expect(bounds.halfExtents).toEqual(new Vec3(2, 2, 1));
});

it('holds the final rubble, allows replay, and clears it before a different motion', () => {
  const status = { textContent: '' };
  const buttons = new Map(['bounce', 'sway', 'earthquake', 'motion-reset'].map((name) => [
    '#landmark-' + name, Object.assign(new EventTarget(), { setAttribute: vi.fn(), removeAttribute: vi.fn() }),
  ]));
  vi.stubGlobal('document', { querySelector: (selector: string) =>
    selector === '#landmark-motion-status' ? status : buttons.get(selector) });
  const click = (name: string) => buttons.get('#landmark-' + name)!.dispatchEvent(new Event('click'));
  let tick!: (delta: number) => void;
  const off = vi.fn();
  const app = { on: (_name: string, update: (delta: number) => void) => { tick = update; return { off }; } };
  const earthquake = { start: vi.fn(), update: vi.fn(), reset: vi.fn() };
  const viewer = bindBuildingMotion(app as unknown as Application, motion, vi.fn(), {}, earthquake);

  click('earthquake');
  expect(status.textContent).toMatch(/shaking/);
  earthquake.reset.mockClear();
  click('bounce');
  tick(1.4);
  expect(status.textContent).toMatch(/breaking apart/);
  tick(earthquakeDuration);
  expect(status.textContent).toMatch(/Collapse complete/);
  expect(earthquake.reset).not.toHaveBeenCalled();
  expect(buttons.get('#landmark-earthquake')?.removeAttribute).toHaveBeenLastCalledWith('aria-disabled');

  click('earthquake');
  expect(earthquake.start).toHaveBeenCalledTimes(2);
  click('motion-reset');
  expect(status.textContent).toBe('Building at rest.');
  earthquake.update.mockClear();
  tick(1);
  expect(earthquake.update).not.toHaveBeenCalled();

  click('earthquake');
  tick(earthquakeDuration);
  earthquake.reset.mockClear();
  click('sway');
  expect(earthquake.reset).toHaveBeenCalledOnce();
  expect(status.textContent).toMatch(/Swaying/);
  viewer.dispose();
  expect(off).toHaveBeenCalledOnce();
});

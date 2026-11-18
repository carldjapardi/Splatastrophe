import { describe, expect, it, vi } from 'vitest';
import catalog from '../public/catalog.json';
import { parseCatalog } from '../src/playground/catalog';
import { createSceneLoader } from '../src/playground/loading';
import { pointOnPlane } from '../src/playground/light';
import { initialViewerState } from '../src/playground/initialState';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('viewer mount defaults', () => {
  it('restores the documented impact strike URL while respecting supported modes', () => {
    const params = new URLSearchParams('mode=impact&strike=1');
    expect(initialViewerState(params, ['bend', 'impact'])).toMatchObject({
      mode: 'impact', strike: true, strength: 0.85,
    });
    expect(initialViewerState(params, ['bend'])).toMatchObject({ mode: 'bend', strike: false, strength: 0 });
    expect(initialViewerState(new URLSearchParams('mode=impact&strike=1&bend=0.9'), ['impact']).strength).toBe(0.9);
  });

  it('builds fresh display/relighting defaults on every mount and preserves explicit URL overrides', () => {
    const previous = initialViewerState(new URLSearchParams(), ['bend']);
    previous.splats = previous.proxy = previous.relighting = false;
    previous.mesh = true;
    expect(initialViewerState(new URLSearchParams(), ['bend'])).toMatchObject({
      mesh: false, splats: true, proxy: true, relighting: true,
    });
    expect(initialViewerState(new URLSearchParams('mesh=1&splats=0&proxy=0'), ['bend'])).toMatchObject({
      mesh: true, splats: false, proxy: false, relighting: true,
    });
  });
});

describe('synthetic catalog', () => {
  it('loads the fixture, camera, supported actions and independent light/aim defaults', () => {
    const [entry] = parseCatalog(catalog);
    expect(entry.actions).toEqual(['bend', 'impact']);
    expect(entry.camera.distance).toBeGreaterThan(0);
    expect(entry.light.position).not.toEqual(entry.light.target);
    expect(entry.fixture).toBe('synthetic-tower');
  });

  it('rejects unsupported real assets and invalid configurations before scene creation', () => {
    const unknown = structuredClone(catalog);
    unknown.buildings[0].fixture = 'barn.ply';
    expect(() => parseCatalog(unknown)).toThrow(/adapters are deferred/);
    const duplicate = structuredClone(catalog);
    duplicate.buildings.push(duplicate.buildings[0]);
    expect(() => parseCatalog(duplicate)).toThrow(/Duplicate/);
    const invalid = structuredClone(catalog);
    invalid.buildings[0].camera.distance = NaN;
    expect(() => parseCatalog(invalid)).toThrow(/camera.distance/);
    const coincident = structuredClone(catalog);
    coincident.buildings[0].light.target = coincident.buildings[0].light.position;
    expect(() => parseCatalog(coincident)).toThrow(/must differ/);
  });
});

describe('scene replacement', () => {
  it('aborts superseded work and disposes a late viewer instead of replacing the current scene', async () => {
    const loader = createSceneLoader<{ dispose(): void }>();
    const first = deferred<{ dispose(): void }>();
    const old = { dispose: vi.fn() };
    const current = { dispose: vi.fn() };
    let firstSignal!: AbortSignal;
    const pending = loader.replace((signal) => { firstSignal = signal; return first.promise; });
    expect(await loader.replace(async () => current)).toBe(current);
    expect(firstSignal.aborted).toBe(true);
    first.resolve(old);
    expect(await pending).toBeUndefined();
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(current.dispose).not.toHaveBeenCalled();
    loader.dispose(); loader.dispose();
    expect(current.dispose).toHaveBeenCalledOnce();
  });

  it('releases an active scene on reload and allows retry after failure', async () => {
    const loader = createSceneLoader<{ dispose(): void }>();
    const current = { dispose: vi.fn() };
    await loader.replace(async () => current);
    await expect(loader.replace(async () => { throw new Error('load failed'); })).rejects.toThrow('load failed');
    expect(current.dispose).toHaveBeenCalledOnce();
    const retried = { dispose: vi.fn() };
    expect(await loader.replace(async () => retried)).toBe(retried);
    loader.dispose();
    expect(retried.dispose).toHaveBeenCalledOnce();
  });

  it('disposes a scene that finishes after the application has closed', async () => {
    const loader = createSceneLoader<{ dispose(): void }>();
    const loading = deferred<{ dispose(): void }>();
    const late = { dispose: vi.fn() };
    const ready = loader.replace(() => loading.promise);
    loader.dispose();
    loading.resolve(late);
    expect(await ready).toBeUndefined();
    expect(late.dispose).toHaveBeenCalledOnce();
    const loadAgain = vi.fn();
    expect(await loader.replace(loadAgain)).toBeUndefined();
    expect(loadAgain).not.toHaveBeenCalled();
  });
});

describe('independent light and aim dragging', () => {
  it('maps a pointer ray to the selected handle height', () => {
    const light = pointOnPlane([0, 10, 10], [10, 0, 0], 6);
    const aim = pointOnPlane([0, 10, 10], [10, 0, 0], 2);
    expect(light).toEqual([4, 6, 6]);
    expect(aim).toEqual([8, 2, 2]);
    expect(pointOnPlane([0, 1, 0], [1, 1, 0], 1)).toBeNull();
    expect(pointOnPlane([0, 1, 0], [0, 2, 0], 0)).toBeNull();
  });
});

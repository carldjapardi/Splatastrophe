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

describe('building catalog', () => {
  it('loads the fixture, camera, supported actions and independent light/aim defaults', () => {
    const entry = parseCatalog(catalog).find(value => value.fixture === 'synthetic-tower')!;
    expect(entry.actions).toEqual(['bend', 'impact']);
    expect(entry.camera.distance).toBeGreaterThan(0);
    expect(entry.light.position).not.toEqual(entry.light.target);
    expect(entry.fixture).toBe('synthetic-tower');
  });

  it('loads camera presets for local landmark assets and rejects unsupported paths', () => {
    const entries = parseCatalog(catalog);
    expect(entries[0]).toMatchObject({ id: 'brandenburg-gate', fixture: 'static-sog', camera: { distance: .31 } });
    expect(entries.filter(value => value.fixture === 'static-sog').map(entry => entry.id)).toEqual([
      'brandenburg-gate', 'trevi-fountain', 'westminster', 'taj-mahal', 'reichstag', 'nara-temple',
    ]);
    const landmark = catalog.buildings[0];
    for (const asset of ['https://example.com/trevi.sog', 'models/../trevi.sog', 'models/trevi.ply']) {
      expect(() => parseCatalog({ schemaVersion: 1, buildings: [{ ...landmark, asset }] })).toThrow(/SOG path/);
    }
  });

  it('rejects unsupported fixtures, duplicate IDs and invalid synthetic settings', () => {
    const tower = catalog.buildings.find(value => value.fixture === 'synthetic-tower')!;
    expect(() => parseCatalog({ schemaVersion: 1, buildings: [{ ...tower, fixture: 'barn.ply' }] })).toThrow(/Unsupported fixture/);
    const duplicate = structuredClone(catalog);
    duplicate.buildings.push(duplicate.buildings[0]);
    expect(() => parseCatalog(duplicate)).toThrow(/Duplicate/);
    const invalid = { ...tower, camera: { ...tower.camera, distance: NaN } };
    expect(() => parseCatalog({ schemaVersion: 1, buildings: [invalid] })).toThrow(/camera.distance/);
    const coincident = { ...tower, light: { ...tower.light, target: tower.light!.position } };
    expect(() => parseCatalog({ schemaVersion: 1, buildings: [coincident] })).toThrow(/must differ/);
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

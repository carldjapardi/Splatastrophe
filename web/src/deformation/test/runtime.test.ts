import { describe, expect, it, vi } from 'vitest';
import { createLifetime, numberParam } from '../src/demo/runtime';

describe('demo parameters', () => {
  it('preserves defaults for absent, empty, and invalid parameters and accepts zero', () => {
    for (const query of ['', 'dir=', 'dir=%20', 'dir=nope', 'dir=Infinity']) {
      expect(numberParam(new URLSearchParams(query), 'dir', 25)).toBe(25);
    }
    expect(numberParam(new URLSearchParams('dir=0'), 'dir', 25)).toBe(0);
    expect(numberParam(new URLSearchParams('bend=0.75'), 'bend', 0)).toBe(0.75);
  });
});

describe('demo lifetime', () => {
  it('removes listeners and disposes resources once, in reverse creation order', () => {
    const lifetime = createLifetime();
    const target = new EventTarget();
    const callback = vi.fn();
    const disposed: string[] = [];
    target.addEventListener('change', callback, { signal: lifetime.signal });
    lifetime.own({ dispose: () => { disposed.push('renderer'); } });
    lifetime.own({ dispose: () => { disposed.push('physics'); } });
    target.dispatchEvent(new Event('change'));
    lifetime.dispose();
    lifetime.dispose();
    target.dispatchEvent(new Event('change'));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(disposed).toEqual(['physics', 'renderer']);
  });

  it('frees a physics resource that resolves after teardown without attaching it', async () => {
    const lifetime = createLifetime();
    const dispose = vi.fn();
    const attach = vi.fn();
    let resolve!: (resource: { dispose(): void }) => void;
    const pending = new Promise<{ dispose(): void }>((done) => { resolve = done; });
    const ready = pending.then((resource) => {
      if (lifetime.own(resource)) attach(resource);
    });
    lifetime.dispose();
    resolve({ dispose });
    await ready;
    expect(dispose).toHaveBeenCalledOnce();
    expect(attach).not.toHaveBeenCalled();
  });

  it('still releases the renderer if another cleanup throws', () => {
    const lifetime = createLifetime();
    const dispose = vi.fn();
    lifetime.own({ dispose });
    lifetime.own({ dispose: () => { throw new Error('physics cleanup'); } });
    expect(() => lifetime.dispose()).toThrow(AggregateError);
    expect(dispose).toHaveBeenCalledOnce();
    expect(lifetime.disposed).toBe(true);
  });
});

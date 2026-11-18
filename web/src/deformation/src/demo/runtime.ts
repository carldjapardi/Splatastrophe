export function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

interface Disposable {
  dispose(): void;
}

/** Owns demo resources, including ones that finish loading after teardown. */
export function createLifetime() {
  const events = new AbortController();
  const resources: Disposable[] = [];
  return {
    signal: events.signal,
    get disposed() { return events.signal.aborted; },
    own(resource: Disposable): boolean {
      if (events.signal.aborted) {
        resource.dispose();
        return false;
      }
      resources.push(resource);
      return true;
    },
    dispose() {
      if (events.signal.aborted) return;
      events.abort();
      // Dispose every resource even if an individual cleanup fails.
      const errors: unknown[] = [];
      for (const resource of resources.splice(0).reverse()) {
        try { resource.dispose(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Demo cleanup failed');
    },
  };
}

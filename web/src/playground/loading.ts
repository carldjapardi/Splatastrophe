interface Disposable { dispose(): void }

/** Cancels obsolete work and releases both active and late-arriving viewers. */
export function createSceneLoader<T extends Disposable>() {
  let pending: AbortController | undefined;
  let active: T | undefined;
  let disposed = false;
  return {
    async replace(load: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
      if (disposed) return;
      pending?.abort();
      active?.dispose();
      active = undefined;
      const request = new AbortController();
      pending = request;
      try {
        const resource = await load(request.signal);
        if (request.signal.aborted) { resource.dispose(); return; }
        active = resource;
        return resource;
      } catch (error) {
        if (!request.signal.aborted) throw error;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending?.abort();
      active?.dispose();
      active = undefined;
    },
  };
}

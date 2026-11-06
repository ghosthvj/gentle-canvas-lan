import { createCanvasRegistry } from './config.js';
import { createCanvasProxy } from './proxy.js';

/** Session-scoped controller. Stop invalidates starts immediately, before queueing cleanup. */
export function createController({ config, createProxy = createCanvasProxy }) {
  const registry = createCanvasRegistry();
  let proxy = null;
  let running = false;
  let enabled = true;
  let disposed = false;
  let generation = 0;
  let tail = Promise.resolve();

  const enqueue = work => {
    const next = tail.then(work);
    tail = next.catch(() => {}); // A bind failure must not poison subsequent explicit starts.
    return next;
  };
  const status = () => {
    const current = registry.current;
    const local = current && new URL(current.url);
    return {
      running, enabled: enabled && !disposed,
      port: running ? proxy.port : null,
      localUrl: current?.url ?? null,
      lanUrl: running && local ? `${config.publicOrigin}${local.pathname}${local.search}` : null,
    };
  };
  const close = async () => {
    const current = proxy;
    proxy = null;
    running = false;
    if (current) await current.stop();
  };
  const ensure = ticket => enqueue(async () => {
    if (disposed || !enabled || ticket !== generation) return status();
    if (running) return status();
    const next = createProxy(config);
    next.setTarget(registry.current);
    proxy = next;
    try {
      await next.start();
      if (disposed || !enabled || ticket !== generation) {
        await close();
      } else {
        running = true;
      }
    } catch (error) {
      await close();
      throw error;
    }
    return status();
  });

  return {
    status,
    start() {
      if (disposed) return Promise.resolve(status());
      enabled = true;
      return ensure(generation);
    },
    async openCanvas(url) {
      if (disposed) return status();
      const target = registry.register(url);
      proxy?.setTarget(target);
      return enabled ? ensure(generation) : status();
    },
    clearCanvas() {
      registry.clear();
      proxy?.setTarget(null);
    },
    stop() {
      enabled = false;
      generation++;
      return enqueue(async () => { await close(); return status(); });
    },
    shutdown() {
      disposed = true;
      registry.clear();
      return this.stop();
    },
  };
}

import { randomBytes } from 'node:crypto';
import { createCanvasRegistry } from './config.js';
import { createCanvasProxy } from './proxy.js';

// Any HTTP answer proves the local canvas server is alive; only a refused
// connection or a timeout means an advertised link would now fail. A dead
// loopback port refuses instantly, so the timeout only guards a hung server and
// stays generous to avoid revoking a live-but-busy canvas.
const probeCanvasLiveness = async url => {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(1500) });
    try { await response.body?.cancel(); } catch {}
    return true;
  } catch {
    return false;
  }
};

/** Session-scoped controller. Stop invalidates starts immediately, before queueing cleanup. */export function createController({ config, createProxy = createCanvasProxy, probeCanvas = probeCanvasLiveness }) {
  const registry = createCanvasRegistry();
  // Stable short capability for the card: fits one terminal line and redirects
  // to whichever canvas is currently registered.
  // Hex avoids trailing '-'/'_' ambiguity in the narrow card while keeping 64 bits.
  const shortCode = randomBytes(8).toString('hex');
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
      shortUrl: running ? `${config.publicOrigin}/s/${shortCode}` : null,
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
    const next = createProxy({ ...config, shortCode });
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
    async checkCanvas() {
      const current = registry.current;
      if (!current || disposed) return false;
      if (await probeCanvas(current.url)) return true;
      // A registration only means "the canvas answered once". Never keep
      // advertising a link that forwards to a dead local server.
      if (registry.current === current) {
        registry.clear();
        proxy?.setTarget(null);
      }
      return false;
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

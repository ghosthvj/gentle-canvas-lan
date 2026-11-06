import { readConfig } from './config.js';
import { createController } from './controller.js';

const usage = 'Usage: /canvas:lan [start|status|stop]';
const noticeUrl = /^Design canvas(?: refreshed)?: (http:\/\/(?:127\.0\.0\.1|localhost):\d+\/\S*)/m;

/** Observe canvas events without modifying tool results or persisting capabilities. */
export function installCanvasLan(pi, { env = process.env, makeController = createController } = {}) {
  let controller;
  let closed = false;
  const pending = new Set();
  const wrappers = new Map();
  const getController = () => controller ??= makeController({ config: readConfig(env) });
  const notify = (ctx, text, level = 'info') => {
    if (!closed && ctx.hasUI) ctx.ui.notify(text, level);
  };
  const report = (ctx, state) => {
    notify(ctx, state.running
      ? state.lanUrl ? `Canvas LAN: ${state.lanUrl}` : 'Canvas LAN proxy running. Open a design to get its URL.'
      : 'Canvas LAN proxy is not running. Use /canvas:lan start to enable it.');
  };
  const track = work => {
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  };
  const open = (url, ctx) => track((async () => {
    if (closed) return;
    try {
      const state = await getController().openCanvas(url);
      report(ctx, state);
    } catch (error) {
      // Config/validation errors are sanitized by the config module. Never echo raw URLs.
      notify(ctx, error instanceof TypeError ? error.message : 'Could not start the LAN canvas proxy. Check the configured address and port.', 'error');
    }
  })());
  const watch = ctx => {
    if (closed || !ctx.hasUI || wrappers.has(ctx.ui)) return;
    const ui = ctx.ui;
    const original = ui.notify;
    const wrapped = function (text, ...args) {
      const result = original.call(this, text, ...args);
      if (!closed && typeof text === 'string') {
        const url = text.match(noticeUrl)?.[1];
        if (url) void open(url, ctx);
        else if (text === 'Design canvas stopped.' || text === 'No design canvas is running.') controller?.clearCanvas();
      }
      return result;
    };
    wrappers.set(ui, { original, wrapped });
    ui.notify = wrapped;
  };

  pi.on('session_start', (_event, ctx) => watch(ctx));
  pi.on('input', (_event, ctx) => watch(ctx));
  pi.registerCommand('canvas:lan', {
    description: 'Access the design canvas on your LAN: /canvas:lan [start|status|stop]',
    handler: async (args, ctx) => {
      if (closed) return;
      watch(ctx);
      const action = String(args ?? '').trim() || 'start';
      if (!['start', 'status', 'stop'].includes(action)) return notify(ctx, usage, 'warning');
      try {
        if (action === 'status') return report(ctx, controller?.status() ?? { running: false });
        if (action === 'stop') {
          if (controller) await controller.stop();
          else await getController().stop();
          return notify(ctx, 'Canvas LAN proxy stopped. Automatic start is disabled until /canvas:lan start.');
        }
        report(ctx, await getController().start());
      } catch (error) {
        notify(ctx, error instanceof TypeError ? error.message : 'Could not start the LAN canvas proxy. Check the configured address and port.', 'error');
      }
    },
  });
  pi.on('tool_execution_end', async (event, ctx) => {
    if (closed || event.toolName !== 'gentle_design' || event.isError) return;
    watch(ctx);
    const details = event.result?.details;
    if (details?.stopped === true || details?.canvas?.running === false) controller?.clearCanvas();
    const url = details?.url ?? details?.canvas?.url;
    if (typeof url === 'string') await open(url, ctx);
  });
  pi.on('session_shutdown', async () => {
    closed = true;
    for (const [ui, { original, wrapped }] of wrappers) {
      // Preserve a later extension's wrapper rather than clobbering its ownership.
      if (ui.notify === wrapped) ui.notify = original;
    }
    wrappers.clear();
    // Dispose immediately: a pending start must observe cancellation, not become live.
    const stopping = controller?.shutdown();
    await Promise.allSettled([...pending]);
    await stopping;
  });
}

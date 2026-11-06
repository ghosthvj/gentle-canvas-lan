import { readConfig } from './config.js';
import { createController } from './controller.js';
import { attachSidebar } from './sidebar-adapter.js';
import { createLanPanel } from './lan-panel.js';

const usage = 'Usage: /canvas:lan [start|status|stop]';
const noticeUrl = /^Design canvas(?: refreshed)?: (http:\/\/(?:127\.0\.0\.1|localhost):\d+\/\S*)/m;

/** Expose LAN access while preserving Gentle Design's own local result fields. */
export function installCanvasLan(pi, { env = process.env, makeController = createController, loadUi = () => import('@earendil-works/pi-tui') } = {}) {
  let controller;
  let closed = false;
  const pending = new Set();
  const wrappers = new Map();
  const observedCalls = new Set();
  let links = null;
  const widgetUis = new Set();
  const presentations = new Map();
  const mounting = new Map();
  let presentationGeneration = 0;
  let uiTools;
  const clearLinks = () => {
    links = null;
    presentationGeneration++;
    for (const ui of widgetUis) ui.setWidget('canvas-lan-links', undefined);
    widgetUis.clear();
    presentations.clear();
    mounting.clear();
  };
  const clearCanvas = () => {
    controller?.clearCanvas();
    clearLinks();
  };
  const showLinks = async ctx => {
    if (closed || !links || !ctx.hasUI || typeof ctx.ui.setWidget !== 'function') return;
    const ui = ctx.ui;
    widgetUis.add(ui);
    if (ctx.mode !== 'tui') {
      ui.setWidget('canvas-lan-links', [`Canvas LAN: ${links.lanUrl}`], { placement: 'belowEditor' });
      return;
    }
    if (presentations.has(ui)) { presentations.get(ui).update(); return; }
    if (mounting.has(ui)) return mounting.get(ui);
    const generation = presentationGeneration;
    const work = (async () => {
      let tools;
      try { tools = await (uiTools ??= loadUi()); }
      catch {
        if (!closed && links && generation === presentationGeneration) {
          ui.setWidget('canvas-lan-links', [`Canvas LAN: ${links.lanUrl}`], { placement: 'belowEditor' });
        }
        return;
      }
      if (closed || !links || generation !== presentationGeneration) return;
      ui.setWidget('canvas-lan-links', (tui, theme) => {
        const panel = createLanPanel({ theme, truncateToWidth: tools.truncateToWidth, visibleWidth: tools.visibleWidth, decorated: true, osc8Probe: true });
        const fallbackPanel = createLanPanel({ theme, truncateToWidth: tools.truncateToWidth, visibleWidth: tools.visibleWidth, osc8Probe: true });
        panel.setUrl(links.shortUrl ?? links.lanUrl);
        fallbackPanel.setUrl(links.shortUrl ?? links.lanUrl);
        const attachment = attachSidebar(tui, panel);
        let disposed = false;
        const view = {
          update() {
            if (disposed) return;
            panel.setUrl(links?.shortUrl ?? links?.lanUrl ?? null);
            fallbackPanel.setUrl(links?.shortUrl ?? links?.lanUrl ?? null);
            attachment?.invalidate();
            tui.requestRender();
          },
          render(width) {
            if (disposed || attachment?.isActive()) return [];
            const rows = fallbackPanel.render(width);
            if (!rows.length) return [];
            const columns = Math.floor(width);
            const title = tools.truncateToWidth(' ▤ CANVAS LAN ', Math.max(0, columns - 1), '');
            const remaining = Math.max(0, columns - 1 - tools.visibleWidth(title));
            const heading = theme.fg('border', '─')
              + theme.fg('dim', theme.bold(title))
              + theme.fg('border', '─'.repeat(remaining));
            return [heading, ...rows.slice(1)];
          },
          invalidate() { panel.invalidate(); fallbackPanel.invalidate(); attachment?.invalidate(); },
          dispose() {
            if (disposed) return;
            disposed = true;
            attachment?.dispose();
            if (presentations.get(ui) === view) presentations.delete(ui);
          },
        };
        presentations.set(ui, view);
        return view;
      }, { placement: 'belowEditor' });
    })();
    mounting.set(ui, work);
    try { await work; }
    finally { if (mounting.get(ui) === work) mounting.delete(ui); }
  };
  const getController = () => controller ??= makeController({ config: readConfig(env) });
  const notify = (ctx, text, level = 'info') => {
    if (!closed && ctx.hasUI) ctx.ui.notify(text, level);
  };
  const report = (ctx, state, announce = true) => {
    if (!closed && state.running && (state.shortUrl || state.lanUrl)) {
      links = { lanUrl: state.lanUrl, shortUrl: state.shortUrl };
      void track(showLinks(ctx));
    } else if (!state.running || !state.lanUrl) clearLinks();
    if (!announce) return;
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
      if (!closed && state.running) links = { lanUrl: state.lanUrl, shortUrl: state.shortUrl };
      report(ctx, state, false);
      return state;
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
        else if (text === 'Design canvas stopped.' || text === 'No design canvas is running.') clearCanvas();
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
          clearLinks();
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
  pi.on('tool_result', async (event, ctx) => {
    if (closed || event.toolName !== 'gentle_design' || event.isError) return;
    const url = event.details?.url ?? event.details?.canvas?.url;
    if (typeof url !== 'string') return;
    watch(ctx);
    const state = await open(url, ctx);
    if (event.toolCallId) observedCalls.add(event.toolCallId);
    if (closed || !state?.running || !state.lanUrl) return;
    return {
      content: [...(event.content ?? []), {
        type: 'text',
        text: `Canvas LAN: ${state.lanUrl}`,
      }],
    };
  });
  pi.on('tool_execution_end', async (event, ctx) => {
    if (observedCalls.delete(event.toolCallId)) return;
    if (closed || event.toolName !== 'gentle_design' || event.isError) return;
    watch(ctx);
    const details = event.result?.details;
    if (details?.stopped === true || details?.canvas?.running === false) clearCanvas();
    const url = details?.url ?? details?.canvas?.url;
    if (typeof url === 'string') await open(url, ctx);
  });
  pi.on('agent_settled', (_event, ctx) => track(showLinks(ctx)));
  pi.on('session_shutdown', async () => {
    closed = true;
    clearLinks();
    for (const [ui, { original, wrapped }] of wrappers) {
      // Preserve a later extension's wrapper rather than clobbering its ownership.
      if (ui.notify === wrapped) ui.notify = original;
    }
    wrappers.clear();
    observedCalls.clear();
    // Dispose immediately: a pending start must observe cancellation, not become live.
    const stopping = controller?.shutdown();
    await Promise.allSettled([...pending]);
    await stopping;
  });
}

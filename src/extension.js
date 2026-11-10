import { readConfig } from './config.js';
import { createController } from './controller.js';
import { createOriginInspector } from './origin-check.js';
import { attachSidebar } from './sidebar-adapter.js';
import { createLanPanel } from './lan-panel.js';
import { defaultSettingsPath, loadSettings, mergeSettings, saveSettings, validateSettings } from './settings.js';
import { createSetupPanel } from './setup-panel.js';
import { truncateToWidth } from './text-fit.js';

const noticeUrl = /^Design canvas(?: refreshed)?: (http:\/\/(?:127\.0\.0\.1|localhost):\d+\/\S*)/m;
// The TUI keeps one transient dim status line and each new info notification
// replaces the previous one, so a multi-line readout would vanish as soon as an
// unrelated extension notified. Persist the readout as a custom entry instead.
const STATUS_ENTRY = 'canvas-lan-status';
const NOTICE_ENTRY = 'canvas-lan-notice';
const statusLines = entry => (Array.isArray(entry?.data?.lines) ? entry.data.lines : []);
// Centered modal for the setup form, matching the Gentle Shell usage overlay.
const SETUP_OVERLAY = { overlay: true, overlayOptions: { anchor: 'center', width: 64, minWidth: 44 } };

/** Sequential prompts, kept for hosts without overlay support. */
const promptFields = async (ctx, current) => {
  if (typeof ctx.ui.input !== 'function') return undefined;
  const ip = await ctx.ui.input('IP to bind', current.ip);
  if (ip === undefined) return undefined;
  const port = await ctx.ui.input('Port', current.port);
  if (port === undefined) return undefined;
  const publicOrigin = await ctx.ui.input('External HTTPS origin (optional; empty clears)', current.publicOrigin);
  if (publicOrigin === undefined) return undefined;
  return { ip, port, publicOrigin };
};

/** Expose LAN access while preserving Gentle Design's own local result fields. */
export function installCanvasLan(pi, { env = process.env, makeController = createController, loadUi = () => import('@earendil-works/pi-tui'), settingsPath = defaultSettingsPath(env), inspectOrigin = createOriginInspector() } = {}) {
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
  let saved = {};
  let settingsLoaded = false;
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
        const panel = createLanPanel({ theme, truncateToWidth: tools.truncateToWidth, visibleWidth: tools.visibleWidth, decorated: true });
        const fallbackPanel = createLanPanel({ theme, truncateToWidth: tools.truncateToWidth, visibleWidth: tools.visibleWidth, actionLabel: false });
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
  const ensureSettings = async () => {
    if (settingsLoaded) return;
    settingsLoaded = true;
    try { saved = await loadSettings(settingsPath); } catch { saved = {}; }
  };
  const effectiveConfig = () => readConfig(mergeSettings(env, saved));
  const getController = async () => {
    await ensureSettings();
    return controller ??= makeController({ config: effectiveConfig() });
  };
  // A registered canvas is not a running canvas: probe before advertising a link.
  const liveState = async instance => {
    if (typeof instance.checkCanvas !== 'function') return instance.status();
    await instance.checkCanvas();
    return instance.status();
  };
  const notify = (ctx, text, level = 'info') => {
    if (!closed && ctx.hasUI) ctx.ui.notify(text, level);
  };
  const report = (ctx, state, announce = true) => {
    if (!closed && state.running && (state.shortUrl || state.lanUrl)) {
      links = { lanUrl: state.lanUrl, shortUrl: state.shortUrl };
      void track(showLinks(ctx));
    } else if (!state.running || !state.lanUrl) clearLinks();
    if (!announce) return;
    showNotice(ctx, state.running
      ? state.lanUrl ? `Canvas LAN: ${state.lanUrl}` : 'Canvas LAN proxy running. Open a design to get its URL.'
      : 'Canvas LAN proxy is not running. Use /canvas-lan:start to enable it.');
  };
  const track = work => {
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  };
  const open = (url, ctx) => track((async () => {
    if (closed) return;
    try {
      const instance = await getController();
      if (closed) return;
      const state = await instance.openCanvas(url);
      if (!closed && state.running) links = { lanUrl: state.lanUrl, shortUrl: state.shortUrl };
      report(ctx, state, false);
      return state;
    } catch (error) {
      // Config/validation errors are sanitized by the config module. Never echo raw URLs.
      showNotice(ctx, error instanceof TypeError ? error.message : 'Could not start the LAN canvas proxy. Check the configured address and port.', 'error');
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
  const paintLines = (entry, theme, role) => {
    const lines = statusLines(entry);
    return {
      render: width => lines.map(line => theme.fg(role, truncateToWidth(line, width))),
      invalidate() {},
      dispose() {},
    };
  };
  if (typeof pi.registerEntryRenderer === 'function') {
    pi.registerEntryRenderer(STATUS_ENTRY, (entry, _options, theme) => paintLines(entry, theme, 'dim'));
    pi.registerEntryRenderer(NOTICE_ENTRY, (entry, _options, theme) => {
      const level = entry?.data?.level;
      return paintLines(entry, theme, level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'dim');
    });
  }
  const showStatus = (ctx, lines) => {
    if (!closed && ctx.mode === 'tui' && typeof pi.appendEntry === 'function') {
      pi.appendEntry(STATUS_ENTRY, { lines });
      return;
    }
    notify(ctx, lines.join('\n'));
  };
  // Command feedback is transcript content in the TUI: the shared status line is
  // single-slot, so any later notification would erase it.
  const showNotice = (ctx, text, level = 'info') => {
    if (!closed && ctx.mode === 'tui' && typeof pi.appendEntry === 'function') {
      pi.appendEntry(NOTICE_ENTRY, { lines: [text], level });
      return;
    }
    notify(ctx, text, level);
  };
  const command = (name, description, handler) => pi.registerCommand(name, {
    description,
    handler: async (_args, ctx) => {
      if (closed) return;
      watch(ctx);
      try { await handler(ctx); }
      catch (error) {
        showNotice(ctx, error instanceof TypeError ? error.message : 'Could not start the LAN canvas proxy. Check the configured address and port.', 'error');
      }
    },
  });
  // Persist the collected values once, then rebuild the proxy so the new endpoint binds.
  const saveSetup = async (ctx, values) => {
    if (!values) return showNotice(ctx, 'LAN setup cancelled; nothing changed.');
    let next;
    try {
      // A hostname origin must at least resolve before anything is persisted;
      // the derived default origin is an IP literal and always passes.
      const candidate = validateSettings(values);
      const inspected = await inspectOrigin({ host: candidate.ip, publicOrigin: candidate.publicOrigin ?? '' });
      if (inspected.kind === 'hostname' && inspected.error) {
        throw new TypeError(`PUBLIC ORIGIN hostname ${inspected.hostname} does not resolve.`);
      }
      next = await saveSettings(settingsPath, values);
    } catch (error) {
      return showNotice(ctx, error instanceof TypeError ? error.message : 'Could not save the Canvas LAN settings. Check the configured address and port.', 'error');
    }
    saved = next;
    // Saving rebuilds the listener only. The registered canvas survives so the
    // next start serves it on the new endpoint instead of answering 502.
    const previous = controller?.status().localUrl ?? null;
    if (controller) {
      await controller.shutdown();
      controller = undefined;
      clearLinks();
    }
    if (previous) {
      try {
        const instance = await getController();
        await instance.stop();
        await instance.openCanvas(previous);
      } catch {
        // An invalid effective configuration is reported by the next command.
      }
    }
    const overrides = ['GENTLE_CANVAS_LAN_IP', 'GENTLE_CANVAS_LAN_PORT', 'GENTLE_CANVAS_LAN_PUBLIC_ORIGIN']
      .filter(key => env[key] !== undefined);
    showNotice(ctx, `Canvas LAN settings saved to ${settingsPath}. Open a design or run /canvas-lan:start to use them.`
      + (overrides.length ? ` Environment overrides active for: ${overrides.join(', ')}.` : ''));
  };
  command('canvas-lan:setup', 'Configure the LAN design-canvas IP and port', async ctx => {
    await ensureSettings();
    const current = {
      ip: saved.ip ?? env.GENTLE_CANVAS_LAN_IP ?? '',
      port: saved.port ?? env.GENTLE_CANVAS_LAN_PORT ?? '34316',
      publicOrigin: saved.publicOrigin ?? env.GENTLE_CANVAS_LAN_PUBLIC_ORIGIN ?? '',
    };
    if (ctx.mode !== 'tui' || typeof ctx.ui.custom !== 'function') {
      if (!ctx.hasUI || typeof ctx.ui.input !== 'function') return showNotice(ctx, '/canvas-lan:setup needs an interactive UI.', 'warning');
      return saveSetup(ctx, await promptFields(ctx, current));
    }
    // The modal validates inline, so a rejected value never closes the form.
    const values = await ctx.ui.custom(async (tui, theme, _keybindings, done) => {
      // Extended key protocols deliver Escape as \x1b[27u; only the host's
      // matcher knows every encoding, so pass it in when it is available.
      let matchesKey;
      try { matchesKey = (await (uiTools ??= loadUi()))?.matchesKey; } catch { matchesKey = undefined; }
      return createSetupPanel({
        theme,
        values: current,
        matchesKey,
        validate: candidate => {
          try {
            validateSettings(candidate);
            return null;
          } catch (error) {
            return error instanceof TypeError ? error.message : 'Invalid settings.';
          }
        },
        submit: next => done(next),
        cancel: () => done(undefined),
        requestRender: () => tui.requestRender(),
      });
    }, SETUP_OVERLAY);
    await saveSetup(ctx, values);
  });

  command('canvas-lan:start', 'Start the LAN design-canvas proxy', async ctx => {
    const instance = await getController();
    await instance.start();
    report(ctx, await liveState(instance));
  });
  command('canvas-lan:status', 'Show LAN design-canvas proxy status', async ctx => {
    await ensureSettings();
    const lines = [];
    let config;
    try {
      config = effectiveConfig();
    } catch {
      lines.push('Canvas LAN is not configured. Run /canvas-lan:setup or set GENTLE_CANVAS_LAN_IP.');
    }
    if (config) {
      const source = (key, savedKey) => env[key] !== undefined ? 'env' : saved[savedKey] !== undefined ? 'saved' : 'unset';
      lines.push(`Canvas LAN IP: ${config.host} (${source('GENTLE_CANVAS_LAN_IP', 'ip')})`);
      lines.push(`Canvas LAN port: ${config.port} (${source('GENTLE_CANVAS_LAN_PORT', 'port')})`);
      if (config.publicOrigin) {
        lines.push(`Canvas LAN origin: ${config.publicOrigin} (${source('GENTLE_CANVAS_LAN_PUBLIC_ORIGIN', 'publicOrigin')})`);
        try {
          const inspected = await inspectOrigin(config);
          if (inspected.kind === 'hostname') {
            if (inspected.error) {
              lines.push(`Origin warning: ${inspected.hostname} does not resolve.`);
            } else if (inspected.matchesBind) {
              lines.push(`Canvas LAN origin resolves to ${inspected.address} (this host).`);
            } else {
              lines.push(`Origin warning: ${inspected.hostname} resolves to ${inspected.address}, not the bind IP`
                + `${inspected.isPublic ? ' and is a public address' : ''} (reverse proxy?).`);
            }
          }
        } catch { /* DNS inspection is advisory only. */ }
      }
    }
    if (env.GENTLE_CANVAS_LAN_HOST !== undefined) {
      lines.push('GENTLE_CANVAS_LAN_HOST is no longer read; export GENTLE_CANVAS_LAN_IP instead.');
    }
    const state = controller ? await liveState(controller) : { running: false };
    if (controller) report(ctx, state, false);
    lines.push(state.running
      ? state.lanUrl ? `Canvas LAN: ${state.lanUrl}` : 'Canvas LAN proxy running. Open a design to get its URL.'
      : 'Canvas LAN proxy is not running. Use /canvas-lan:start to enable it.');
    showStatus(ctx, lines);
  });
  command('canvas-lan:stop', 'Stop the LAN design-canvas proxy', async ctx => {
    clearLinks();
    if (controller) await controller.stop();
    else await (await getController()).stop();
    showNotice(ctx, 'Canvas LAN proxy stopped. Automatic start is disabled until /canvas-lan:start.');
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
    await Promise.allSettled([...pending]);
    const stopping = controller?.shutdown();
    await stopping;
  });
}

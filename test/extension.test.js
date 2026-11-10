import test from 'node:test';
import assert from 'node:assert/strict';
import { installCanvasLan } from '../src/extension.js';

const url = 'http://127.0.0.1:41234/abcdefghijklmnop/d/demo/';


function fixture(options = {}) {
  const handlers = new Map();
  let component;
  const terminal = options.terminal ?? {};
  const tui = { mode: 'fullscreen', terminal, requestRender() {} };
  const theme = { fg: (_role, value) => value, bold: value => value, underline: value => value };
  const commands = new Map();
  const notices = [];
  const entries = [];
  const renderers = new Map();
  const calls = [];
  const widgets = new Map();
  let running = false;
  let canvas = true;
  const local = 'http://127.0.0.1:41234/abcdefghijklmnop/d/demo/';
  // Mirrors the real controller: no link once nothing is registered.
  const state = () => ({
    running,
    localUrl: canvas ? local : null,
    lanUrl: running && canvas ? 'http://192.168.1.20:34316/abcdefghijklmnop/d/demo/' : null,
    shortUrl: running && canvas ? 'http://192.168.1.20:34316/s/0123456789abcdef' : null,
  });
  const controller = {
    status: state,
    async start() { calls.push('start'); running = true; return state(); },
    async stop() { calls.push('stop'); running = false; return state(); },
    async openCanvas(value) { calls.push(['open', value]); running = true; canvas = true; return state(); },
    async checkCanvas() {
      calls.push('probe');
      if (typeof options.canvasAlive === 'function') canvas = options.canvasAlive();
      else if (options.canvasAlive === false) canvas = false;
      return canvas;
    },
    clearCanvas() { calls.push('clear'); canvas = false; },
    async shutdown() { calls.push('shutdown'); running = false; canvas = false; },
  };
  const pi = {
    on: (event, fn) => handlers.set(event, fn),
    registerCommand: (name, spec) => commands.set(name, spec),
    registerEntryRenderer: (customType, renderer) => renderers.set(customType, renderer),
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }),
  };
  const inputs = [...(options.inputResponses ?? [])];
  const overlays = [];
  const overlayRenders = [];
  const ui = {
    notify(text, level) { notices.push([text, level]); return 'original-result'; },
    input: async (_title, _placeholder) => inputs.shift(),
    ...(options.overlay ? {
      async custom(factory, overlayOptions) {
        overlays.push(overlayOptions);
        let finish;
        // A driven overlay must finish: without this guard a stuck panel would
        // hang the whole file instead of failing one test.
        const result = new Promise((resolve, reject) => {
          const guard = setTimeout(() => reject(new Error('setup overlay never finished')), 200);
          guard.unref();
          finish = value => { clearTimeout(guard); resolve(value); };
        });
        const component = await factory({ requestRender() {} }, theme, {}, value => finish(value));
        for (const key of options.overlay.keys) {
          component.handleInput(key);
          overlayRenders.push(component.render(60).join('\n'));
        }
        return result;
      },
    } : {}),
    setWidget(key, lines, options) {
      component?.dispose?.();
      component = undefined;
      if (lines === undefined) widgets.delete(key);
      else {
        if (typeof lines === 'function') component = lines(tui, theme);
        widgets.set(key, { lines, options });
      }
    },
  };
  const original = ui.notify;
  const ctx = { hasUI: true, ui, ...(options.tuiMode ? { mode: 'tui' } : {}) };
  installCanvasLan(pi, { env: { GENTLE_CANVAS_LAN_IP: '192.168.1.20' }, settingsPath: options.settingsPath ?? '/nonexistent/gentle-canvas-lan/config.json', makeController: (opts) => { calls.push('construct'); calls.push(opts?.config); return controller; }, loadUi: async () => ({
    truncateToWidth: (value, width) => value.slice(0, width),
    visibleWidth: value => value.length,
    // Extended key protocols: Escape arrives as a CSI-u sequence, never a bare ESC.
    matchesKey: (data, id) => id === 'escape' && (data === '\x1b' || data === '\x1b[27u'),
  }), ...options });
  return { pi, calls, notices, widgets, entries, renderers, ctx, original, commands, overlays, overlayRenders, component: () => component, emit: async (name, event = {}) => handlers.get(name)?.(event, ctx) };
}

test('status warns when a hostname origin does not resolve or is not the bind IP', async () => {
  const entries = [];
  const unresolvable = fixture({ tuiMode: true, inspectOrigin: async () => ({ kind: 'hostname', hostname: 'canvas.example', address: null, error: true }) });
  unresolvable.pi.appendEntry = (type, data) => entries.push({ type, data });
  const mismatched = fixture({ tuiMode: true, inspectOrigin: async () => ({ kind: 'hostname', hostname: 'canvas.example', address: '203.0.113.5', isPublic: true, matchesBind: false }) });
  mismatched.pi.appendEntry = (type, data) => entries.push({ type, data });
  const bound = fixture({ tuiMode: true, inspectOrigin: async () => ({ kind: 'hostname', hostname: 'canvas.lan', address: '192.168.1.20', isPublic: false, matchesBind: true }) });
  bound.pi.appendEntry = (type, data) => entries.push({ type, data });
  for (const f of [unresolvable, mismatched, bound]) {
    f.pi.registerEntryRenderer?.('canvas-lan-status', () => ({ render: () => [] }));
  }
  const linesOf = () => entries.at(-1).data.lines;
  await unresolvable.commands.get('canvas-lan:status').handler('', unresolvable.ctx);
  assert.match(linesOf().join('\n'), /does not resolve/);
  await mismatched.commands.get('canvas-lan:status').handler('', mismatched.ctx);
  assert.match(linesOf().join('\n'), /203\.0\.113\.5/);
  assert.match(linesOf().join('\n'), /not the bind IP/);
  await bound.commands.get('canvas-lan:status').handler('', bound.ctx);
  assert.match(linesOf().join('\n'), /192\.168\.1\.20 \(this host\)/);
});

test('setup rejects an origin hostname that does not resolve without saving', async t => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-origin-'));
  const settingsPath = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture({
    settingsPath,
    inputResponses: ['192.168.1.20', '34316', 'https://canvas.example'],
    inspectOrigin: async () => ({ kind: 'hostname', hostname: 'canvas.example', address: null, error: true }),
  });
  await f.commands.get('canvas-lan:setup').handler('', f.ctx);
  assert.match(f.notices.at(-1)[0], /does not resolve/);
  try { await readFile(settingsPath, 'utf8'); assert.fail('settings must not be written'); } catch (e) { assert.equal(e.code, 'ENOENT'); }
});

test('entry registers without opening resources; command help/status/start/stop', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  await f.emit('session_start');
  assert.deepEqual([...f.commands.keys()].sort(), [
    'canvas-lan:setup', 'canvas-lan:start', 'canvas-lan:status', 'canvas-lan:stop',
  ]);
  // The host lists commands in registration order, so pin the lifecycle order:
  // configure first, then start, inspect and stop.
  assert.deepEqual([...f.commands.keys()], [
    'canvas-lan:setup', 'canvas-lan:start', 'canvas-lan:status', 'canvas-lan:stop',
  ]);
  await f.commands.get('canvas-lan:status').handler('', f.ctx);
  assert.deepEqual(f.calls, []);
  assert.match(f.notices.at(-1)[0], /not running/);
  await f.commands.get('canvas-lan:start').handler('', f.ctx);
  assert.deepEqual(f.calls.slice(0, 1), ['construct']);
  assert.match(f.notices.at(-1)[0], /Canvas LAN: http/);
  await f.commands.get('canvas-lan:stop').handler('', f.ctx);
  assert.equal(f.calls.at(-1), 'stop');
  await f.emit('session_shutdown');
});

test('TUI mounts LAN-only sidebar and restores footer when stopped', async () => {
  const footer = { render: () => ['STATUS'], invalidate() {}, digest: () => 'status' };
  const host = { active: true, parts: new Map([['footer', footer]]), ownsHost: () => true };
  const terminal = { [Symbol.for('gentle-pi.experimental-sidebar.state')]: host };
  const f = fixture({ tuiMode: true, terminal });
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  await f.emit('agent_settled');
  assert.notEqual(host.parts.get('footer'), footer);
  const rendered = host.parts.get('footer').render(48).join('\n');
  assert.match(rendered, /CANVAS LAN/);
  assert.equal(rendered.includes('Local'), false);
  assert.equal(rendered.includes('127.0.0.1'), false);
  assert.deepEqual(f.component().render(48), []);
  host.active = false;
  assert.match(f.component().render(48).join('\n'), /CANVAS LAN/);
  await f.commands.get('canvas-lan:stop').handler('', f.ctx);
  assert.equal(host.parts.get('footer'), footer);
  assert.equal(f.widgets.size, 0);
  await f.emit('session_shutdown');
});

test('status reports effective host and port with their source', async t => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-status-'));
  const settingsPath = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(settingsPath, JSON.stringify({ ip: '192.168.1.30', port: '35000', publicOrigin: 'https://canvas.example' }));
  const saved = fixture({ env: {}, settingsPath });
  await saved.commands.get('canvas-lan:status').handler('', saved.ctx);
  assert.match(saved.notices.at(-1)[0], /Canvas LAN IP: 192\.168\.1\.30 \(saved\)/);
  assert.match(saved.notices.at(-1)[0], /Canvas LAN port: 35000 \(saved\)/);
  assert.match(saved.notices.at(-1)[0], /Canvas LAN origin: https:\/\/canvas\.example \(saved\)/);
  await saved.emit('session_shutdown');
  const overridden = fixture({ env: { GENTLE_CANVAS_LAN_IP: '192.168.1.20' }, settingsPath });
  await overridden.commands.get('canvas-lan:status').handler('', overridden.ctx);
  assert.match(overridden.notices.at(-1)[0], /Canvas LAN IP: 192\.168\.1\.20 \(env\)/);
  assert.match(overridden.notices.at(-1)[0], /Canvas LAN port: 35000 \(saved\)/);
  await overridden.emit('session_shutdown');
  const unset = fixture({ env: {}, settingsPath: '/nonexistent/canvas-status/config.json' });
  await unset.commands.get('canvas-lan:status').handler('', unset.ctx);
  assert.match(unset.notices.at(-1)[0], /not configured/);
  await unset.emit('session_shutdown');
});

test('status readout persists in the TUI transcript instead of the shared status line', async () => {
  const f = fixture({ tuiMode: true });
  const renderer = f.renderers.get('canvas-lan-status');
  assert.equal(typeof renderer, 'function');
  await f.commands.get('canvas-lan:status').handler('', f.ctx);
  const entry = f.entries.at(-1);
  assert.equal(entry.customType, 'canvas-lan-status');
  const readout = entry.data.lines.join('\n');
  assert.match(readout, /Canvas LAN IP: 192\.168\.1\.20 \(env\)/);
  assert.match(readout, /Canvas LAN proxy is not running/);
  // The TUI keeps only the newest info notification in one dim line, so this
  // readout must not depend on it.
  assert.deepEqual(f.notices, []);
  assert.deepEqual(renderer(entry, { expanded: false }, { fg: (_role, value) => value }).render(80), entry.data.lines);
  await f.emit('session_shutdown');
});

test('status retires a stale card instead of advertising a dead canvas', async () => {
  const f = fixture({ tuiMode: true, canvasAlive: false });
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  assert.equal(f.widgets.size, 1);
  await f.commands.get('canvas-lan:status').handler('', f.ctx);
  assert.equal(f.widgets.size, 0);
  const readout = f.entries.at(-1).data.lines.join('\n');
  assert.match(readout, /Canvas LAN proxy running\. Open a design to get its URL\./);
  assert.doesNotMatch(readout, /abcdefghijklmnop|\/s\//, 'no dead canvas link survives');
  await f.emit('session_shutdown');
});

test('start does not advertise a link while no design canvas is running', async () => {
  const f = fixture({ canvasAlive: false });
  await f.commands.get('canvas-lan:start').handler('', f.ctx);
  assert.equal(f.notices.at(-1)[1], 'info');
  assert.match(f.notices.at(-1)[0], /Canvas LAN proxy running\. Open a design to get its URL\./);
  assert.doesNotMatch(f.notices.at(-1)[0], /http:\/\//);
  assert.equal(f.widgets.size, 0);
  await f.emit('session_shutdown');
});

test('setup menu persists host and port and rebuilds the controller', async t => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-menu-'));
  const settingsPath = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture({ env: {}, settingsPath, inputResponses: [' 192.168.1.50 ', '35000', ''] });
  await f.commands.get('canvas-lan:setup').handler('', f.ctx);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), { ip: '192.168.1.50', port: '35000' });
  assert.match(f.notices.at(-1)[0], /settings saved/);
  await f.commands.get('canvas-lan:start').handler('', f.ctx);
  const config = f.calls.find(call => call && typeof call === 'object' && 'host' in call);
  assert.deepEqual(config, { host: '192.168.1.50', port: 35000, publicOrigin: 'http://192.168.1.50:35000' });
  await f.emit('session_shutdown');
});

test('sequential fallback: setup cancellation and invalid values leave saved settings untouched', async t => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-menu-'));
  const settingsPath = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(settingsPath, JSON.stringify({ ip: '192.168.1.20', port: '34316' }));
  for (const responses of [[undefined], ['0.0.0.0', '34316', '']]) {
    const f = fixture({ settingsPath, inputResponses: responses });
    await f.commands.get('canvas-lan:setup').handler('', f.ctx);
    assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), { ip: '192.168.1.20', port: '34316' });
    assert.deepEqual(f.calls, []);
    if (responses[0] === undefined) assert.match(f.notices.at(-1)[0], /cancelled/);
    else assert.match(f.notices.at(-1)[0], /IP must be a concrete unicast address/);
    await f.emit('session_shutdown');
  }
});

test('setup opens a centered overlay and saves the edited values', async t => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-overlay-'));
  const settingsPath = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const keys = [...'192.168.1.50', '\t', ...'\x7f'.repeat(5), ...'35000', '\r'];
  const f = fixture({ tuiMode: true, env: {}, settingsPath, overlay: { keys } });
  await f.commands.get('canvas-lan:setup').handler('', f.ctx);
  assert.deepEqual(f.overlays, [{ overlay: true, overlayOptions: { anchor: 'center', width: 64, minWidth: 44 } }]);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), { ip: '192.168.1.50', port: '35000' });
  // TUI feedback is durable: a transcript entry, not the single-slot status line.
  assert.match(f.entries.at(-1).data.lines[0], /settings saved/);
  assert.deepEqual(f.notices, []);
  await f.emit('session_shutdown');
});

test('setup overlay reports an invalid value inline and cancels without saving', async t => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-overlay-'));
  const settingsPath = join(dir, 'config.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const keys = ['\t', ...'\x7f'.repeat(5), '0', '\r', '\x1b'];
  const f = fixture({ tuiMode: true, settingsPath, overlay: { keys } });
  await f.commands.get('canvas-lan:setup').handler('', f.ctx);
  assert.ok(f.overlayRenders.some(row => /PORT must be an integer/.test(row)));
  assert.match(f.entries.at(-1).data.lines[0], /cancelled; nothing changed/);
  await assert.rejects(readFile(settingsPath, 'utf8'), { code: 'ENOENT' });
  assert.deepEqual(f.calls, []);
  await f.emit('session_shutdown');
});

test('environment variables override saved menu values', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-menu-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, 'config.json');
  const f = fixture({ env: {}, settingsPath, inputResponses: ['192.168.1.20', '34316', ''] });
  await f.commands.get('canvas-lan:setup').handler('', f.ctx);
  const overridden = fixture({ env: { GENTLE_CANVAS_LAN_PORT: '40000' }, settingsPath });
  await overridden.commands.get('canvas-lan:start').handler('', overridden.ctx);
  const config = overridden.calls.find(call => call && typeof call === 'object' && 'host' in call);
  assert.equal(config.port, 40000);
  await f.emit('session_shutdown');
  await overridden.emit('session_shutdown');
});

test('narrow fallback has a themed separator without altering sidebar or link target', async () => {
  const footer = { render: () => ['STATUS'], invalidate() {} };
  let eligible = true;
  const host = { active: true, parts: new Map([['footer', footer]]), ownsHost: () => eligible };
  const terminal = { [Symbol.for('gentle-pi.experimental-sidebar.state')]: host };
  const f = fixture({ tuiMode: true, terminal });
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  await f.emit('agent_settled');
  assert.deepEqual(f.component().render(40), []);
  assert.equal(host.parts.get('footer').render(40).some(row => /^─+$/.test(row)), false);
  eligible = false;
  host.active = false;
  for (const width of [80, 40, 1]) {
    const rows = f.component().render(width);
    if (width >= 40) assert.equal(rows[0], `─ ▤ CANVAS LAN ${'─'.repeat(width - 15)}`);
    else assert.equal(rows[0], '─');
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].length, width);
    const plain = rows.join('').replace(/\x1b\[[0-9;]*m/g, '');
    assert.equal(plain.includes('Open Design Canvas'), false);
    assert.ok(plain.includes('http://192.168.1.20:34316/'));
  }
  eligible = true;
  host.active = true;
  assert.deepEqual(f.component().render(40), []);
  await f.emit('session_shutdown');
});

test('later MCP-style footer does not duplicate the LAN presentation', async () => {
  const footer = { render: () => ['STATUS'], invalidate() {} };
  const host = { active: true, parts: new Map([['footer', footer]]) };
  const terminal = { [Symbol.for('gentle-pi.experimental-sidebar.state')]: host };
  const f = fixture({ tuiMode: true, terminal });
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  await f.emit('agent_settled');
  const captured = host.parts.get('footer');
  host.parts.set('footer', {
    render: width => [...captured.render(width), 'MCP'],
    invalidate: () => captured.invalidate(),
  });
  // The card renders the stable shortcut, which is what must not be duplicated.
  const lan = 'http://192.168.1.20:34316/s/0123456789abcdef';
  const sidebar = host.parts.get('footer').render(80).join('');
  const fallback = f.component().render(80).join('');
  assert.equal(Number(sidebar.includes(lan)) + Number(fallback.includes(lan)), 1);
  assert.equal(sidebar.includes('STATUS'), true);
  assert.equal(sidebar.includes('MCP'), true);
  await f.emit('session_shutdown');
});

test('card uses the stable short LAN capability while results keep the full LAN URL', async () => {
  const short = 'http://192.168.1.20:34316/s/AbCdEfGhIjKlMnOp';
  const full = 'http://192.168.1.20:34316/abcdefghijklmnop/d/demo/';
  const footer = { render: () => ['STATUS'], invalidate() {} };
  const host = { active: true, parts: new Map([['footer', footer]]), ownsHost: () => true };
  const terminal = { [Symbol.for('gentle-pi.experimental-sidebar.state')]: host };
  const f = fixture({ tuiMode: true, terminal, makeController: () => ({ async openCanvas() { return { running: true, lanUrl: full, shortUrl: short }; }, async shutdown() {} }) });
  const result = await f.emit('tool_result', { toolName: 'gentle_design', details: { url }, content: [{ type: 'text', text: 'original' }] });
  assert.match(result.content.at(-1).text, new RegExp(full));
  await f.emit('agent_settled');
  assert.match(host.parts.get('footer').render(60).join('\n'), new RegExp(short.replaceAll('.', '\\.')));
  assert.doesNotMatch(host.parts.get('footer').render(60).join('\n'), /abcdefghijklmnop/);
  await f.emit('session_shutdown');
});

test('automatic canvas opens keep links visible without redundant success notifications', async () => {
  const f = fixture();
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  assert.deepEqual(f.notices, []);
  assert.equal(f.widgets.size, 1);
  await f.commands.get('canvas-lan:status').handler('', f.ctx);
  assert.match(f.notices.at(-1)[0], /Canvas LAN: http/);
  await f.emit('session_shutdown');
});

test('successful tool result shapes register; errors/irrelevant results do not', async () => {
  const f = fixture();
  for (const event of [
    { toolName: 'other', result: { details: { url } } },
    { toolName: 'gentle_design', isError: true, result: { details: { url } } },
    { toolName: 'gentle_design', result: {} },
  ]) await f.emit('tool_execution_end', event);
  assert.deepEqual(f.calls, []);
  for (const details of [{ url }, { canvas: { running: true, url } }]) {
    await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details } });
  }
  assert.equal(f.calls.filter(x => Array.isArray(x)).length, 2);
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { stopped: true } } });
  assert.equal(f.calls.at(-1), 'clear');
  await f.emit('session_shutdown');
});

test('settled UI shows both links even when the final assistant omits LAN', async () => {
  const f = fixture();
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  await f.emit('tool_execution_end', { toolName: 'other', result: { content: [] } });
  await f.emit('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: `Canvas: ${url}` }] } });
  await f.emit('agent_settled');
  assert.deepEqual(f.widgets.get('canvas-lan-links'), {
    lines: ['Canvas LAN: http://192.168.1.20:34316/abcdefghijklmnop/d/demo/'],
    options: { placement: 'belowEditor' },
  });
  const before = f.calls.length;
  await f.emit('agent_settled');
  assert.equal(f.calls.length, before);
  await f.emit('session_shutdown');
  assert.equal(f.widgets.size, 0);
});

test('stop and canvas revocation clear links; settled does not restore stale widgets', async () => {
  for (const revoke of ['proxy-stop', 'tool-stop', 'list-stopped', 'notice-stop']) {
    const f = fixture();
    await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
    await f.emit('agent_settled');
    assert.equal(f.widgets.size, 1);
    if (revoke === 'proxy-stop') await f.commands.get('canvas-lan:stop').handler('', f.ctx);
    if (revoke === 'tool-stop') await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { stopped: true } } });
    if (revoke === 'list-stopped') await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { canvas: { running: false } } } });
    if (revoke === 'notice-stop') f.ctx.ui.notify('Design canvas stopped.', 'info');
    await f.emit('agent_settled');
    assert.equal(f.widgets.size, 0, revoke);
    await f.emit('session_shutdown');
  }
});

test('settled without a running canvas does not create widgets or controllers', async () => {
  const f = fixture();
  await f.emit('agent_settled');
  assert.deepEqual(f.calls, []);
  assert.equal(f.widgets.size, 0);
  await f.emit('session_shutdown');
  await f.emit('agent_settled');
  assert.equal(f.widgets.size, 0);
});

test('tool result adds only LAN without replacing original local content or details', async () => {
  const f = fixture();
  const content = [{ type: 'text', text: `Design canvas: ${url}` }, { type: 'image', data: 'fixture', mimeType: 'image/png' }];
  const details = { url, opened: false };
  const event = { toolName: 'gentle_design', toolCallId: 'open-1', content, details, isError: false };
  const result = await f.emit('tool_result', event);
  assert.deepEqual(result.content.slice(0, 2), content);
  assert.equal(result.content[2].text, 'Canvas LAN: http://192.168.1.20:34316/abcdefghijklmnop/d/demo/');
  assert.equal(result.content.filter(block => block.type === 'text' && block.text.includes(url)).length, 1);
  assert.equal(result.details, undefined);
  assert.deepEqual(event.content, content);
  assert.equal(event.details, details);
  await f.emit('tool_execution_end', { toolName: 'gentle_design', toolCallId: 'open-1', result: { content: result.content, details } });
  assert.equal(f.calls.filter(x => Array.isArray(x)).length, 1);
  assert.equal(f.notices.length, 0);
  await f.emit('session_shutdown');
});

test('tool result leaves failed, unrelated and unavailable LAN results unchanged', async () => {
  const f = fixture({ env: {} });
  for (const event of [
    { toolName: 'other', details: { url } },
    { toolName: 'gentle_design', isError: true, details: { url } },
    { toolName: 'gentle_design', details: {} },
    { toolName: 'gentle_design', details: { url }, content: [{ type: 'text', text: 'Original' }] },
  ]) assert.equal(await f.emit('tool_result', event), undefined);
  assert.deepEqual(f.calls, []);
  await f.emit('session_shutdown');
});

test('list tool result includes only LAN; stopped proxy does not advertise LAN', async () => {
  const f = fixture();
  const result = await f.emit('tool_result', { toolName: 'gentle_design', details: { canvas: { running: true, url } }, content: [] });
  assert.equal(result.content[0].text, 'Canvas LAN: http://192.168.1.20:34316/abcdefghijklmnop/d/demo/');
  assert.equal(result.content[0].text.includes('Local'), false);
  await f.emit('session_shutdown');
  const stopped = fixture({ makeController: () => ({ async openCanvas() { return { running: false, lanUrl: null }; }, async shutdown() {} }) });
  assert.equal(await stopped.emit('tool_result', { toolName: 'gentle_design', details: { url }, content: [] }), undefined);
  await stopped.emit('session_shutdown');
});

test('notice fallback preserves UI results and restores wrapper on shutdown', async () => {
  const f = fixture();
  await f.emit('session_start');
  await f.emit('input');
  assert.equal(f.ctx.ui.notify(`Design canvas refreshed: ${url}\nOpen manually.`, 'warning'), 'original-result');
  // Let the asynchronous settings load finish before shutdown races it.
  await new Promise(resolve => setTimeout(resolve, 20));
  // Shutdown waits for the asynchronous notice registration before disposing.
  await f.emit('session_shutdown');
  assert.equal(f.calls.filter(x => Array.isArray(x)).length, 1);
  assert.equal(f.calls.at(-1), 'shutdown');
  assert.equal(f.ctx.ui.notify, f.original);
  const count = f.calls.length;
  f.ctx.ui.notify(`Design canvas: ${url}`, 'info');
  assert.equal(f.calls.length, count);
});

test('stop notices clear registration without creating a controller', async () => {
  const f = fixture();
  await f.emit('session_start');
  f.ctx.ui.notify('Design canvas stopped.', 'info');
  assert.deepEqual(f.calls, []);
  await f.commands.get('canvas-lan:start').handler('', f.ctx);
  f.ctx.ui.notify('No design canvas is running.', 'info');
  assert.equal(f.calls.at(-1), 'clear');
  await f.emit('session_shutdown');
});

test('invalid configuration reports an actionable error and exposes nothing', async () => {
  const f = fixture({ env: {} });
  await f.commands.get('canvas-lan:start').handler('', f.ctx);
  assert.deepEqual(f.calls, []);
  assert.match(f.notices.at(-1)[0], /IP must be a concrete unicast address/);
  assert.equal(f.notices.at(-1)[1], 'error');
  await f.emit('session_shutdown');
});

test('shutdown suppresses late notifications and ignores subsequent tool results', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let stopped = 0;
  const f = fixture({ makeController: () => ({
    async openCanvas() { await gate; return { running: true, lanUrl: 'http://canvas.test/token/' }; },
    async shutdown() { stopped++; },
  }) });
  const open = f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  const end = f.emit('session_shutdown');
  release();
  await Promise.all([open, end]);
  assert.equal(f.notices.length, 0);
  assert.equal(stopped, 1);
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  assert.equal(f.notices.length, 0);
});

test('setup overlay cancels with an extended Escape sequence and saves nothing', async () => {
  const f = fixture({ overlay: { keys: ['\x1b[27u'] } });
  await f.commands.get('canvas-lan:setup').handler('', f.ctx);
  assert.match(f.notices.at(-1)[0], /cancelled; nothing changed/);
  assert.equal(f.calls.includes('construct'), false);
  await f.emit('session_shutdown');
});

test('status warns that the removed HOST variable is no longer read', async () => {
  const f = fixture({ tuiMode: true, env: { GENTLE_CANVAS_LAN_IP: '192.168.1.20', GENTLE_CANVAS_LAN_HOST: '192.168.1.99' } });
  await f.commands.get('canvas-lan:status').handler('', f.ctx);
  const readout = f.entries.at(-1).data.lines.join('\n');
  assert.match(readout, /Canvas LAN IP: 192\.168\.1\.20 \(env\)/);
  assert.match(readout, /GENTLE_CANVAS_LAN_HOST is no longer read; export GENTLE_CANVAS_LAN_IP instead\./);
  assert.doesNotMatch(readout, /192\.168\.1\.99/);
  await f.emit('session_shutdown');
});

test('the removed HOST variable alone cannot start a listener or reach a default address', async () => {
  const f = fixture({ env: { GENTLE_CANVAS_LAN_HOST: '192.168.1.99' } });
  await f.commands.get('canvas-lan:start').handler('', f.ctx);
  assert.deepEqual(f.calls, [], 'no controller is constructed without an IP');
  assert.match(f.notices.at(-1)[0], /IP must be a concrete unicast address/);
  await f.emit('session_shutdown');
});

test('command feedback persists in the TUI transcript instead of the shared status line', async () => {
  const f = fixture({ tuiMode: true });
  await f.commands.get('canvas-lan:start').handler('', f.ctx);
  const started = f.entries.at(-1);
  assert.equal(started.customType, 'canvas-lan-notice');
  assert.equal(started.data.level, 'info');
  assert.match(started.data.lines[0], /^Canvas LAN: http:\/\/192\.168\.1\.20:34316\//);
  assert.deepEqual(f.notices, [], 'nothing relies on the single-slot status line');
  await f.commands.get('canvas-lan:stop').handler('', f.ctx);
  const stopped = f.entries.at(-1);
  assert.equal(stopped.customType, 'canvas-lan-notice');
  assert.match(stopped.data.lines[0], /Canvas LAN proxy stopped/);
  const renderer = f.renderers.get('canvas-lan-notice');
  assert.equal(typeof renderer, 'function');
  assert.deepEqual(renderer(stopped, {}, { fg: (_role, value) => value }).render(80), stopped.data.lines);
  await f.emit('session_shutdown');
});

test('errors persist as a durable notice with the error level', async () => {
  const failed = fixture({ tuiMode: true, env: {} });
  await failed.commands.get('canvas-lan:start').handler('', failed.ctx);
  const error = failed.entries.at(-1);
  assert.equal(error.customType, 'canvas-lan-notice');
  assert.equal(error.data.level, 'error');
  assert.match(error.data.lines[0], /IP must be a concrete unicast address/);
  const roles = [];
  failed.renderers.get('canvas-lan-notice')(error, {}, { fg: (role, value) => { roles.push(role); return value; } }).render(80);
  assert.deepEqual(roles, ['error']);
  await failed.emit('session_shutdown');
});


test('saved setup settings persist as a durable notice', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-notice-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const saved = fixture({
    tuiMode: true,
    env: {},
    settingsPath: join(dir, 'config.json'),
    overlay: { keys: [...'192.168.1.50', '\t', ...'\x7f'.repeat(5), ...'35000', '\r'] },
  });
  await saved.commands.get('canvas-lan:setup').handler('', saved.ctx);
  const notice = saved.entries.at(-1);
  assert.equal(notice.customType, 'canvas-lan-notice');
  assert.match(notice.data.lines[0], /settings saved/);
  assert.deepEqual(saved.notices, []);
  await saved.emit('session_shutdown');
});

test('saving a new port keeps the canvas registered for the next start', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'canvas-rebind-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture({
    tuiMode: true,
    settingsPath: join(dir, 'config.json'),
    overlay: { keys: ['\t', ...'\x7f'.repeat(5), ...'8099', '\r'] },
  });
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  assert.equal(f.widgets.size, 1, 'the open design registers the canvas');
  await f.commands.get('canvas-lan:setup').handler('', f.ctx);
  assert.equal(f.widgets.size, 0, 'saving stops the listener and clears the card');
  await f.commands.get('canvas-lan:start').handler('', f.ctx);
  assert.ok(f.calls.some(call => Array.isArray(call) && call[0] === 'open'), 'the registered canvas is kept');
  assert.match(f.entries.at(-1).data.lines[0], /^Canvas LAN: http:\/\/192\.168\.1\.20:34316\//);
  assert.equal(f.widgets.size, 1, 'the card returns with the preserved canvas');
  await f.emit('session_shutdown');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { installCanvasLan } from '../src/extension.js';

const url = 'http://127.0.0.1:41234/abcdefghijklmnop/d/demo/';
function fixture(options = {}) {
  const handlers = new Map();
  let component;
  const terminal = options.terminal ?? {};
  const tui = { mode: 'fullscreen', terminal, requestRender() {} };
  const theme = { fg: (_role, value) => value, bold: value => value };
  const commands = new Map();
  const notices = [];
  const calls = [];
  const widgets = new Map();
  let running = false;
  const state = () => ({ running, lanUrl: running ? 'http://192.168.1.20:34316/abcdefghijklmnop/d/demo/' : null });
  const controller = {
    status: state,
    async start() { calls.push('start'); running = true; return state(); },
    async stop() { calls.push('stop'); running = false; return state(); },
    async openCanvas(value) { calls.push(['open', value]); running = true; return state(); },
    clearCanvas() { calls.push('clear'); },
    async shutdown() { calls.push('shutdown'); running = false; },
  };
  const pi = { on: (event, fn) => handlers.set(event, fn), registerCommand: (name, spec) => commands.set(name, spec) };
  const ui = {
    notify(text, level) { notices.push([text, level]); return 'original-result'; },
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
  installCanvasLan(pi, { env: { GENTLE_CANVAS_LAN_HOST: '192.168.1.20' }, makeController: () => { calls.push('construct'); return controller; }, loadUi: async () => ({ truncateToWidth: (value, width) => value.slice(0, width), visibleWidth: value => value.length }), ...options });
  return { pi, calls, notices, widgets, ctx, original, commands, component: () => component, emit: async (name, event = {}) => handlers.get(name)?.(event, ctx) };
}

test('entry registers without opening resources; command help/status/start/stop', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  await f.emit('session_start');
  const command = f.commands.get('canvas:lan');
  await command.handler('status', f.ctx);
  assert.deepEqual(f.calls, []);
  assert.match(f.notices.at(-1)[0], /not running/);
  await command.handler('invalid', f.ctx);
  assert.equal(f.notices.at(-1)[0], 'Usage: /canvas:lan [start|status|stop]');
  await command.handler('', f.ctx);
  assert.deepEqual(f.calls, ['construct', 'start']);
  assert.match(f.notices.at(-1)[0], /Canvas LAN: http/);
  await command.handler('stop', f.ctx);
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
  await f.commands.get('canvas:lan').handler('stop', f.ctx);
  assert.equal(host.parts.get('footer'), footer);
  assert.equal(f.widgets.size, 0);
  await f.emit('session_shutdown');
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
    assert.equal(rows[0], '─'.repeat(width));
    assert.equal(rows.length, 3);
    assert.equal(rows[1], 'CANVAS LAN'.slice(0, width));
    const target = rows[2].match(/\x1b\]8;;([^\x1b\x07]+)(?:\x1b\\|\x07)/)?.[1];
    assert.equal(target, 'http://192.168.1.20:34316/abcdefghijklmnop/d/demo/');
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
  const lan = 'http://192.168.1.20:34316/abcdefghijklmnop/d/demo/';
  const sidebar = host.parts.get('footer').render(80).join('');
  const fallback = f.component().render(80).join('');
  assert.equal(Number(sidebar.includes(lan)) + Number(fallback.includes(lan)), 1);
  assert.equal(sidebar.includes('STATUS'), true);
  assert.equal(sidebar.includes('MCP'), true);
  await f.emit('session_shutdown');
});

test('automatic canvas opens keep links visible without redundant success notifications', async () => {
  const f = fixture();
  await f.emit('tool_execution_end', { toolName: 'gentle_design', result: { details: { url } } });
  assert.deepEqual(f.notices, []);
  assert.equal(f.widgets.size, 1);
  await f.commands.get('canvas:lan').handler('status', f.ctx);
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
    if (revoke === 'proxy-stop') await f.commands.get('canvas:lan').handler('stop', f.ctx);
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
  await f.commands.get('canvas:lan').handler('start', f.ctx);
  f.ctx.ui.notify('No design canvas is running.', 'info');
  assert.equal(f.calls.at(-1), 'clear');
  await f.emit('session_shutdown');
});

test('invalid configuration reports an actionable error and exposes nothing', async () => {
  const f = fixture({ env: {} });
  await f.commands.get('canvas:lan').handler('start', f.ctx);
  assert.deepEqual(f.calls, []);
  assert.match(f.notices.at(-1)[0], /GENTLE_CANVAS_LAN_HOST/);
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

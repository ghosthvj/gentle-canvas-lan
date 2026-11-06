import test from 'node:test';
import assert from 'node:assert/strict';
import install from '../extensions/canvas-lan.js';
import { installCanvasLan } from '../src/extension.js';

const url = 'http://127.0.0.1:41234/abcdefghijklmnop/d/demo/';
function fixture(options = {}) {
  const handlers = new Map();
  const commands = new Map();
  const notices = [];
  const calls = [];
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
  const ui = { notify(text, level) { notices.push([text, level]); return 'original-result'; } };
  const original = ui.notify;
  const ctx = { hasUI: true, ui };
  installCanvasLan(pi, { env: { GENTLE_CANVAS_LAN_HOST: '192.168.1.20' }, makeController: () => { calls.push('construct'); return controller; }, ...options });
  return { pi, calls, notices, ctx, original, commands, emit: async (name, event = {}) => handlers.get(name)?.(event, ctx) };
}

test('entry registers without opening resources; command help/status/start/stop', async () => {
  assert.equal(typeof install, 'function');
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

test('tool result exposes both Local and LAN without replacing existing content or details', async () => {
  const f = fixture();
  const content = [{ type: 'text', text: `Design canvas: ${url}` }, { type: 'image', data: 'fixture', mimeType: 'image/png' }];
  const details = { url, opened: false };
  const event = { toolName: 'gentle_design', toolCallId: 'open-1', content, details, isError: false };
  const result = await f.emit('tool_result', event);
  assert.deepEqual(result.content.slice(0, 2), content);
  assert.equal(result.content[2].text, `Canvas Local: ${url}\nCanvas LAN: http://192.168.1.20:34316/abcdefghijklmnop/d/demo/`);
  assert.equal(result.details, undefined);
  assert.deepEqual(event.content, content);
  assert.equal(event.details, details);
  await f.emit('tool_execution_end', { toolName: 'gentle_design', toolCallId: 'open-1', result: { content: result.content, details } });
  assert.equal(f.calls.filter(x => Array.isArray(x)).length, 1);
  assert.equal(f.notices.length, 1);
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

test('list tool result also includes both links; stopped proxy does not advertise LAN', async () => {
  const f = fixture();
  const result = await f.emit('tool_result', { toolName: 'gentle_design', details: { canvas: { running: true, url } }, content: [] });
  assert.match(result.content[0].text, /^Canvas Local: http/);
  assert.match(result.content[0].text, /\nCanvas LAN: http/);
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

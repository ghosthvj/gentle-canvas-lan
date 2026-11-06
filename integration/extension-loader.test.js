import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GENTLE_PI_ROOT;
if (!root) throw new Error('Set GENTLE_PI_ROOT to the installed gentle-pi directory.');
const { createJiti } = await import(pathToFileURL(join(root, 'node_modules/jiti/lib/jiti.mjs')).href);
const jiti = createJiti(import.meta.url, {
  fsCache: false, moduleCache: false,
  alias: { '@earendil-works/pi-tui': join(root, 'node_modules/@earendil-works/pi-tui/dist/index.js') },
});

// Exercise the actual entry, host-resolved helpers and native-JS/Jiti boundary.
// No private sessions, providers, user designs or installed files are touched.
test('real entry under host loader mounts a sidebar rather than silent string fallback', { timeout: 10000 }, async t => {
  const reserve = net.createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const keys = ['GENTLE_CANVAS_LAN_HOST', 'GENTLE_CANVAS_LAN_PORT', 'GENTLE_CANVAS_LAN_PUBLIC_ORIGIN'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.GENTLE_CANVAS_LAN_HOST = '127.0.0.1';
  process.env.GENTLE_CANVAS_LAN_PORT = String(port);
  delete process.env.GENTLE_CANVAS_LAN_PUBLIC_ORIGIN;
  const handlers = new Map();
  const footer = { render: () => ['STATUS'], invalidate() {}, digest: () => 'status' };
  const host = { active: true, ownsHost: () => true, parts: new Map([['footer', footer]]) };
  const tui = { mode: 'fullscreen', terminal: { [Symbol.for('gentle-pi.experimental-sidebar.state')]: host }, requestRender() {} };
  const theme = { fg: (_role, value) => value, bold: value => value, underline: value => value };
  let component;
  let kind;
  const ctx = { mode: 'tui', hasUI: true, ui: {
    notify() {},
    setWidget(_key, value) {
      component?.dispose?.();
      component = undefined;
      kind = typeof value;
      if (typeof value === 'function') component = value(tui, theme);
    },
  } };
  t.after(async () => {
    await handlers.get('session_shutdown')?.({}, ctx);
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  });
  const { default: install } = await jiti.import(resolve('extensions/canvas-lan.js'));
  await install({ on: (event, fn) => handlers.set(event, fn), registerCommand() {} });
  await handlers.get('session_start')({}, ctx);
  await handlers.get('tool_execution_end')({ toolName: 'gentle_design', result: { details: { url: 'http://127.0.0.1:12345/abcdefghijklmnop/d/demo/' } } }, ctx);
  await handlers.get('agent_settled')({}, ctx);
  assert.equal(kind, 'function', 'must mount a component factory, not a plain string-array fallback');
  assert.notEqual(host.parts.get('footer'), footer);
  const rows = host.parts.get('footer').render(180).join('\n');
  assert.match(rows, /CANVAS LAN/);
  assert.match(rows, new RegExp(`http://127\\.0\\.0\\.1:${port}/abcdefghijklmnop/d/demo/`));
  assert.deepEqual(component.render(180), []);
  await handlers.get('session_shutdown')({}, ctx);
  assert.equal(host.parts.get('footer'), footer);
});

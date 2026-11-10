import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createController } from '../src/controller.js';
import { installCanvasLan } from '../src/extension.js';

// S19: stable short LAN capability for the card, full tokenized URL everywhere else.
const publicOrigin = 'http://canvas.test:34316';
const host = 'canvas.test:34316';
const token = 'q'.repeat(32);
const rotated = 'w'.repeat(32);

const get = (port, path, { method = 'GET', hostHeader = host } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { host: hostHeader } }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
  });
  req.on('error', reject);
  req.end();
});

test('short code is a stable session capability that redirects without reaching upstream', async t => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('CANVAS-BODY');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const upstreamPort = upstream.address().port;
  const c = createController({ config: { host: '127.0.0.1', port: 0, publicOrigin } });
  t.after(() => c.shutdown());

  assert.equal(c.status().shortUrl, null);
  const first = await c.openCanvas(`http://127.0.0.1:${upstreamPort}/${token}/d/demo/?view=1`);
  assert.match(first.shortUrl, /^http:\/\/canvas\.test:34316\/s\/[0-9a-f]{16}$/);
  assert.equal(first.lanUrl, `${publicOrigin}/${token}/d/demo/?view=1`);
  const code = first.shortUrl.slice(-16);
  const shortPath = `/s/${code}`;

  const redirect = await get(first.port, shortPath);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.location, first.lanUrl);
  assert.equal(redirect.location.includes(token), true);
  assert.equal(redirect.body, '');
  assert.equal(seen.length, 0, 'redirect must not hit upstream');

  for (const [label, path, expected, options] of [
    ['wrong code', `/s/${'A'.repeat(16)}`, 404],
    ['missing code', '/s/', 404],
    ['short code', `/s/${code.slice(0, 8)}`, 404],
    ['suffixed code', `/s/${code}x`, 404],
    ['case-mangled code', `/s/${code.toUpperCase() === code ? code.toLowerCase() : code.toUpperCase()}`, 404],
    ['foreign Host', shortPath, 421, { hostHeader: 'attacker.test:34316' }],
    ['wrong-port Host', shortPath, 421, { hostHeader: '127.0.0.1:1' }],
    ['POST', shortPath, 404, { method: 'POST' }],
    ['HEAD', shortPath, 404, { method: 'HEAD' }],
  ]) {
    const res = await get(first.port, path, options);
    assert.equal(res.status, expected, label);
    assert.equal(res.location, undefined, `${label} must not redirect`);
  }
  assert.equal(seen.length, 0, 'no rejected short request may reach upstream');

  assert.equal((await get(first.port, `/${token}/d/demo/`)).body, 'CANVAS-BODY');
  assert.equal(seen.length, 1);

  const beforeRotation = seen.length;
  const second = await c.openCanvas(`http://127.0.0.1:${upstreamPort}/${rotated}/d/demo/`);
  assert.equal(second.port, first.port, 'listener stays fixed');
  assert.equal(second.shortUrl, first.shortUrl, 'short capability survives rotation');
  assert.equal((await get(first.port, shortPath)).location, `${publicOrigin}/${rotated}/d/demo/`);
  assert.equal((await get(first.port, `/${token}/d/demo/`)).status, 404, 'old token revoked');
  assert.equal(seen.length, beforeRotation, 'rotation redirect did not hit upstream');
});

test('card shows only the short capability while status and tool output keep the full URL', async () => {
  let component;
  const handlers = new Map();
  const notices = [];
  const tui = { mode: 'fullscreen', terminal: {}, requestRender() {} };
  const theme = { fg: (_role, value) => value, bold: value => value, underline: value => value };
  const ui = {
    notify: (text, level) => notices.push([text, level]),
    setWidget: (_key, lines) => {
      if (typeof lines === 'function') component = lines(tui, theme);
    },
  };
  const ctx = { hasUI: true, mode: 'tui', ui };
  const pi = {
    on: (event, fn) => handlers.set(event, fn),
    registerCommand: (name, spec) => handlers.set(`command:${name}`, spec.handler),
  };
  const upstream = http.createServer((_req, res) => { res.writeHead(200); res.end('CANVAS-BODY'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  installCanvasLan(pi, {
    env: { GENTLE_CANVAS_LAN_IP: '127.0.0.1', GENTLE_CANVAS_LAN_PORT: '34317' },
    settingsPath: '/nonexistent/gentle-canvas-lan/config.json',
    loadUi: async () => ({
      truncateToWidth: (value, width) => value.slice(0, width),
      visibleWidth: value => value.length,
    }),
  });
  try {
    const canvas = `http://127.0.0.1:${upstreamPort}/${token}/d/demo/`;
    const result = await handlers.get('tool_result')({ toolName: 'gentle_design', details: { url: canvas }, content: [] }, ctx);
    assert.equal(result.content.at(-1).text, `Canvas LAN: http://127.0.0.1:34317/${token}/d/demo/`);
    await handlers.get('agent_settled')({}, ctx);
    const rows = component.render(80);
    const flat = rows.join('\n');
    assert.match(flat, /\/s\/[A-Za-z0-9_-]{16}/);
    assert.equal(flat.includes(token), false, 'card must never leak the canvas token');
    const stripOsc = row => row.replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '');
    assert.equal(rows.map(stripOsc).filter(row => /\/s\/[0-9a-f]{16}/.test(row)).length, 1,
      'plain URL row fits one line');
    await handlers.get('command:canvas-lan:status')('', ctx);
    assert.match(notices.at(-1)[0], new RegExp(`Canvas LAN: http://127\\.0\\.0\\.1:34317/${token}/d/demo/`));
    assert.match(notices.at(-1)[0], /Canvas LAN IP: 127\.0\.0\.1 \(env\)/);
    assert.match(notices.at(-1)[0], /Canvas LAN port: 34317 \(env\)/);
  } finally {
    await handlers.get('session_shutdown')({}, ctx);
    await new Promise(resolve => upstream.close(resolve));
  }
});

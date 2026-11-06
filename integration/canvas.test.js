import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createController } from '../src/controller.js';
import { createLanPanel } from '../src/lan-panel.js';

// Explicit local installation, never network resolution or automatic dependency installation.
const root = process.env.GENTLE_PI_ROOT;
if (!root) throw new Error('Set GENTLE_PI_ROOT to the installed gentle-pi directory.');
const { createJiti } = await import(pathToFileURL(join(root, 'node_modules/jiti/lib/jiti.mjs')).href);
const jiti = createJiti(import.meta.url, { fsCache: false });
const { startDesignCanvasServer } = await jiti.import(join(root, 'lib/design-canvas-server.ts'));
const { truncateToWidth, visibleWidth } = await import(pathToFileURL(join(root, 'node_modules/@earendil-works/pi-tui/dist/index.js')).href);

const publicOrigin = 'http://canvas.test:34316';
function request(port, path, { method = 'GET', origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method,
      headers: { host: 'canvas.test:34316', ...(origin ? { origin } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}
function stream(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, headers: { host: 'canvas.test:34316' } });
    req.on('error', reject);
    req.on('response', res => {
      res.on('error', () => {});
      res.once('data', chunk => resolve({ req, res, chunk: chunk.toString() }));
    });
  });
}

test('real installed canvas: page, sandbox resources, POST, SSE, rotation and stop', { timeout: 15000 }, async t => {
  await mkdir('.test-tmp', { recursive: true });
  const fixture = await mkdtemp(resolve('.test-tmp/canvas-'));
  const designRoot = join(fixture, 'design');
  const design = join(designRoot, 'demo');
  await mkdir(design, { recursive: true });
  await writeFile(join(design, 'design.json'), JSON.stringify({ artboards: [{ file: 'board.html', width: 800, height: 600 }] }));
  await writeFile(join(design, 'board.html'), '<!doctype html><title>LAN fixture</title><link rel="stylesheet" href="my%20style.css"><h1>Fixture</h1>');
  await writeFile(join(design, 'my style.css'), 'h1 { color: blue; }');
  await writeFile(join(design, 'part#one.css'), 'body { margin: 0; }');
  const comments = [];
  let canvas;
  const controller = createController({ config: { host: '127.0.0.1', port: 0, publicOrigin } });
  t.after(async () => { await controller.shutdown(); await canvas?.close(); await rm(fixture, { recursive: true, force: true }); });
  const start = () => startDesignCanvasServer({ designRoot, initialSlug: 'demo', onComment: comment => { comments.push(comment); } });
  canvas = await start();
  const state = await controller.openCanvas(canvas.url);
  const base = `/${canvas.token}/`;
  const panel = createLanPanel({ theme: { fg: (_role, text) => text, bold: text => text, underline: text => text }, truncateToWidth, visibleWidth });
  panel.setUrl(state.lanUrl);
  for (const width of [48, 40, 20]) {
    const cardLine = truncateToWidth(panel.render(width)[1], width - 2);
    const target = cardLine.match(/\x1b\]8;;([^\x1b\x07]+)(?:\x1b\\|\x07)/)?.[1];
    assert.equal(target, state.lanUrl, 'terminal link target must retain the entire token and design path');
    const parsed = new URL(target);
    assert.equal((await request(state.port, parsed.pathname + parsed.search)).status, 200);
  }
  const page = await request(state.port, `${base}d/demo/`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<!doctype html>/i);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal((await request(state.port, `${base}assets/canvas.js`)).status, 200);
  const board = await request(state.port, `${base}files/demo/board.html`, { origin: 'null' });
  assert.equal(board.status, 200);
  assert.match(board.text, /LAN fixture/);
  assert.ok(board.headers['content-security-policy'].includes(`frame-ancestors http://127.0.0.1:${canvas.port} http://localhost:${canvas.port} ${publicOrigin}`));
  for (const name of ['my%20style.css', 'part%23one.css']) assert.equal((await request(state.port, `${base}files/demo/${name}`, { origin: 'null' })).status, 200);
  const body = JSON.stringify({ slug: 'demo', file: 'board.html', selector: 'body', comment: 'fixture' });
  assert.equal((await request(state.port, `${base}api/comments`, { method: 'POST', origin: 'http://evil.test', body })).status, 403);
  assert.equal(comments.length, 0);
  const posted = await request(state.port, `${base}api/comments`, { method: 'POST', origin: publicOrigin, body });
  assert.equal(posted.status, 202, posted.text);
  assert.equal(comments.length, 1);
  const sse = await stream(state.port, `${base}events`);
  assert.match(sse.chunk, /connected/);
  const shown = new Promise(resolve => sse.res.once('data', chunk => resolve(chunk.toString())));
  canvas.show('demo');
  assert.match(await shown, /event: show/);
  const changed = new Promise(resolve => {
    const onData = chunk => {
      const text = chunk.toString();
      if (text.includes('event: change')) {
        sse.res.off('data', onData);
        resolve(text);
      }
    };
    sse.res.on('data', onData);
  });
  await writeFile(join(design, 'board.html'), '<!doctype html><title>Updated fixture</title><h1>Changed</h1>');
  assert.match(await changed, /event: change/);
  const staleClosed = new Promise(resolve => sse.res.once('close', resolve));
  await canvas.close();
  canvas = await start();
  const next = await controller.openCanvas(canvas.url);
  assert.equal(next.port, state.port);
  assert.notEqual(`/${canvas.token}/`, base);
  await staleClosed;
  const old = await request(next.port, `${base}d/demo/`);
  assert.equal(old.status, 404);
  assert.equal(old.text, 'Not Found\n');
  assert.equal((await request(next.port, `/${canvas.token}/d/demo/`)).status, 200);
  await controller.stop();
  await assert.rejects(request(next.port, `/${canvas.token}/`), { code: 'ECONNREFUSED' });
});

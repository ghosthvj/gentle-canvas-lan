import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createController } from '../src/controller.js';

const token = 'abcdefghijklmnop';
const url = `http://127.0.0.1:40123/${token}/d/demo/?view=1`;
const config = { host: '127.0.0.1', port: 0, publicOrigin: 'http://canvas.test:34316' };

function fake(start = async () => {}) {
  const calls = { starts: 0, stops: 0, targets: [] };
  return { calls, createProxy: () => ({
    port: 34316,
    setTarget: target => calls.targets.push(target),
    start: async () => { calls.starts++; await start(); },
    stop: async () => { calls.stops++; },
  }) };
}

test('register starts lazily; rotates target and preserves selected path on fixed listener', async () => {
  const f = fake();
  const c = createController({ config, createProxy: f.createProxy });
  assert.equal(c.status().running, false);
  assert.equal(f.calls.starts, 0);
  const first = await c.openCanvas(url);
  assert.match(first.shortUrl, /\/s\/[A-Za-z0-9_-]{16}$/);
  assert.equal(first.lanUrl, `http://canvas.test:34316/${token}/d/demo/?view=1`);
  const other = `http://127.0.0.1:40124/${'z'.repeat(32)}/`;
  const next = await c.openCanvas(other);
  assert.equal(next.port, first.port);
  assert.equal(next.shortUrl, first.shortUrl, 'short capability survives canvas rotation');
  assert.equal(f.calls.starts, 1);
  assert.equal(f.calls.targets.at(-1).origin, 'http://127.0.0.1:40124');
  const before = c.status();
  await assert.rejects(c.openCanvas('http://evil.test/token/'), TypeError);
  assert.deepEqual(c.status(), before);
  c.clearCanvas();
  assert.equal(c.status().lanUrl, null);
  assert.equal(f.calls.targets.at(-1), null);
  await c.shutdown();
});

test('explicit stop disables automatic start until explicit start; shutdown is terminal', async () => {
  const f = fake();
  const c = createController({ config, createProxy: f.createProxy });
  await c.openCanvas(url);
  await c.stop();
  await c.stop();
  assert.equal((await c.openCanvas(url)).running, false);
  assert.equal(f.calls.starts, 1);
  assert.equal((await c.start()).running, true);
  await c.shutdown();
  await c.shutdown();
  assert.equal((await c.start()).running, false);
  assert.equal((await c.openCanvas(url)).running, false);
  assert.equal(c.status().localUrl, null);
});

test('concurrent starts share one listener and stop cancels a pending start', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = fake(async () => { entered(); await gate; });
  const c = createController({ config, createProxy: f.createProxy });
  const a = c.start();
  const b = c.start();
  await started;
  const stop = c.stop();
  release();
  await Promise.all([a, b, stop]);
  assert.equal(c.status().running, false);
  assert.equal(f.calls.starts, 1);
  assert.equal(f.calls.stops, 1);
  assert.equal((await c.start()).running, true);
  await c.shutdown();
});

test('real occupied port fails without stealing it; later explicit start can recover', async t => {
  const occupied = http.createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const port = occupied.address().port;
  const c = createController({ config: { ...config, port } });
  t.after(async () => { await c.shutdown(); if (occupied.listening) await new Promise(r => occupied.close(r)); });
  await assert.rejects(c.start(), { code: 'EADDRINUSE' });
  assert.equal(c.status().running, false);
  assert.equal(occupied.listening, true);
  await new Promise(r => occupied.close(r));
  assert.equal((await c.start()).port, port);
  await c.shutdown();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createCanvasProxy } from '../src/proxy.js';

const token = 'abcdefghijklmnop';
const publicOrigin = 'https://canvas.example.test';
const host = new URL(publicOrigin).host;
const listen = async server => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const close = server => new Promise(resolve => {
  server.close(resolve);
  server.closeAllConnections();
});
async function fixture(t) {
  const seen = [];
  let mutations = 0;
  const upstream = http.createServer(async (req, res) => {
    seen.push({ url: req.url, method: req.method, headers: req.headers });
    if (req.url.includes('/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ready\n\n');
      return;
    }
    if (req.url.includes('/hang')) return;
    if (req.url.includes('/abort')) {
      res.writeHead(200);
      res.write('partial');
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (!['GET', 'POST'].includes(req.method)) {
      res.writeHead(405, { allow: 'GET, POST' });
      res.end('Method not allowed');
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.method === 'POST') mutations++;
    res.writeHead(201, {
      'content-type': 'application/json',
      'content-security-policy': req.url.includes('/page')
        ? "default-src 'self'; frame-ancestors 'none'"
        : `default-src ${origin}; frame-ancestors 'self' ${origin}; img-src ${origin}`,
      connection: 'keep-alive, x-private',
      'x-private': 'hidden',
    });
    res.end(JSON.stringify({ url: req.url, method: req.method, body }));
  });
  const upstreamPort = await listen(upstream);
  const origin = `http://127.0.0.1:${upstreamPort}`;
  const proxy = createCanvasProxy({ host: '127.0.0.1', port: 0, publicOrigin });
  await proxy.start();
  proxy.setTarget({ origin, token });
  t.after(async () => { await proxy.stop(); await close(upstream); });
  const request = (path = `/${token}/`, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: proxy.port, path, method: options.method ?? 'GET',
      headers: { host, ...options.headers },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
  return { proxy, upstream, origin, seen, request, mutations: () => mutations };
}

const errors = { 421: 'Misdirected Request\n', 404: 'Not Found\n', 403: 'Forbidden\n' };
const canvasDown = /Gentle Design canvas is not running/;
async function rejected(f, path, options, status) {
  const before = [f.seen.length, f.mutations()];
  const response = await f.request(path, options);
  assert.equal(response.status, status);
  if (options.method === 'HEAD') assert.equal(response.body, '');
  else if (status === 502) {
    assert.match(response.body, canvasDown);
    assert.match(response.headers['content-type'], /^text\/html/);
  } else assert.equal(response.body, errors[status]);
  assert.deepEqual([f.seen.length, f.mutations()], before);
}

test('guards reject hosts, origins and raw path tricks without upstream effects', async t => {
  const f = await fixture(t);
  await rejected(f, `/${token}/`, { headers: { host: 'evil.test', 'x-forwarded-host': host } }, 421);
  for (const path of [
    '/wrongtokenabcdef/', `http://${host}/${token}/`, `/%61${token.slice(1)}/`,
    `/${token}extra/`, `/${token}/../other`, `/${token}/%2e%2e/other`,
    `/${token}\\other`, `/${token}/%5cother`, `/${token}/./files/a`, '/',
    `/${token}/%252e%252e/other`, `/%25${token.slice(1)}/`,
  ]) await rejected(f, path, {}, 404);
  for (const origin of ['https://evil.test', `${publicOrigin}/`, 'null']) {
    await rejected(f, `/${token}/`, { headers: { origin } }, 403);
    await rejected(f, `/${token}/comments`, { method: 'POST', headers: { origin }, body: '{}' }, 403);
  }
  for (const method of ['POST', 'HEAD', 'OPTIONS']) {
    await rejected(f, `/${token}/`, { method }, 403);
  }
  await rejected(f, `/${token}/files/a`, { method: 'POST', headers: { origin: 'null' } }, 403);
});

test('forwards GET/query, JSON POST, exact origins and upstream method errors', async t => {
  const f = await fixture(t);
  const path = `/${token}/files/a?q=%2F&x=1`;
  const get = await f.request(path);
  assert.equal(get.status, 201);
  assert.equal(get.body, JSON.stringify({ url: path, method: 'GET', body: '' }));
  const body = '{"comment":"hello"}';
  const post = await f.request(`/${token}/comments`, {
    method: 'POST', headers: { origin: publicOrigin, 'content-type': 'application/json' }, body,
  });
  assert.equal(post.status, 201);
  assert.equal(post.body, JSON.stringify({ url: `/${token}/comments`, method: 'POST', body }));
  assert.equal(f.mutations(), 1);
  assert.equal(f.seen[1].headers.origin, f.origin);
  assert.equal(f.seen[1].headers['content-type'], 'application/json');
  const method = await f.request(`/${token}/`, { method: 'DELETE', headers: { origin: publicOrigin } });
  assert.equal(method.status, 405);
  assert.equal(method.body, 'Method not allowed');
  assert.equal(method.headers.allow, 'GET, POST');
  for (const remainder of ['files/a.svg', 'system.html', 'assets/inspector.js']) {
    assert.equal((await f.request(`/${token}/${remainder}?x=1`, { headers: { origin: 'null' } })).status, 201);
    assert.equal(f.seen.at(-1).headers.origin, 'null');
  }
});

test('encoded spaces, hashes and UTF-8 resource filenames reach the canvas unchanged', async t => {
  const f = await fixture(t);
  for (const name of ['my%20board.html', 'section%23one.svg', 'caf%C3%A9.css']) {
    const path = `/${token}/files/demo/${name}`;
    const response = await f.request(path, { headers: { origin: 'null' } });
    assert.equal(response.status, 201);
    assert.equal(response.body, JSON.stringify({ url: path, method: 'GET', body: '' }));
    assert.equal(f.seen.at(-1).url, path);
  }
  await rejected(f, `/${token}/files/demo/raw#fragment`, {}, 404);
  assert.equal(f.mutations(), 0);
});

test('strips unsafe headers and changes only eligible CSP directive', async t => {
  const f = await fixture(t);
  const response = await f.request(`/${token}/files/a`, { headers: {
    origin: publicOrigin, referer: 'https://secret.test/',
    connection: 'keep-alive, x-secret', 'x-secret': 'hidden',
    forwarded: 'host=evil', 'x-forwarded-host': 'evil', 'x-forwarded-proto': 'http',
    'x-real-ip': 'evil',
  } });
  const headers = f.seen[0].headers;
  for (const name of ['referer', 'x-secret', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']) {
    assert.equal(headers[name], undefined);
  }
  assert.equal(headers.host, new URL(f.origin).host);
  assert.equal(response.headers['x-private'], undefined);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.headers['content-security-policy'],
    `default-src ${f.origin}; frame-ancestors 'self' ${f.origin} ${publicOrigin}; img-src ${f.origin}`);
  assert.equal((await f.request(`/${token}/page`)).headers['content-security-policy'],
    "default-src 'self'; frame-ancestors 'none'");
});

function stream(f, remainder = 'events') {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: f.proxy.port, path: `/${token}/${remainder}`, headers: { host } });
    req.on('error', reject);
    req.on('response', res => {
      res.on('error', () => {});
      res.once('data', chunk => resolve({ req, res, chunk: chunk.toString() }));
    });
  });
}

test('SSE streams immediately, survives header deadline, disconnect cancels upstream', { timeout: 8000 }, async t => {
  const f = await fixture(t);
  const incoming = once(f.upstream, 'request');
  const s = await stream(f);
  assert.equal(s.chunk, 'data: ready\n\n');
  assert.equal(s.res.statusCode, 200);
  f.proxy.setTarget({ origin: f.origin, token });
  await new Promise(resolve => setTimeout(resolve, 5100));
  assert.equal(s.res.destroyed, false);
  const [upReq, upRes] = await incoming;
  const nextChunk = once(s.res, 'data');
  upRes.write('data: later\n\n');
  assert.equal((await nextChunk)[0].toString(), 'data: later\n\n');
  const ended = once(upReq.socket, 'close');
  s.req.destroy();
  await ended;
});

test('target validation preserves registration; rotation closes streams and rejects old token', { timeout: 2000 }, async t => {
  const f = await fixture(t);
  for (const origin of ['http://localhost:1234', 'https://127.0.0.1:1234',
    'http://127.0.0.1:0', 'http://user@127.0.0.1:1234', `${f.origin}/path`]) {
    assert.throws(() => f.proxy.setTarget({ origin, token }), /Invalid canvas target/);
  }
  for (const invalidToken of ['short', 'x'.repeat(129), 'x'.repeat(15) + '%']) {
    assert.throws(() => f.proxy.setTarget({ origin: f.origin, token: invalidToken }), /Invalid canvas target/);
  }
  assert.equal((await f.request()).status, 201);
  assert.doesNotThrow(() => f.proxy.setTarget({ origin: f.origin, token: 'x'.repeat(128) }));
  assert.doesNotThrow(() => f.proxy.setTarget({ origin: 'http://127.0.0.1', token }));
  assert.doesNotThrow(() => f.proxy.setTarget({ origin: 'http://127.0.0.1:80', token }));
  f.proxy.setTarget({ origin: f.origin, token });
  assert.equal((await f.request()).status, 201);
  const s = await stream(f);
  const closed = new Promise(resolve => s.res.once('close', resolve));
  const replacement = 'qrstuvwxyzABCDEF';
  f.proxy.setTarget({ origin: f.origin, token: replacement });
  await closed;
  await rejected(f, `/${token}/`, {}, 404);
  assert.equal((await f.request(`/${replacement}/`)).status, 201);
  f.proxy.setTarget({ origin: f.origin, token });
  const cleared = await stream(f);
  const clearClosed = new Promise(resolve => cleared.res.once('close', resolve));
  f.proxy.setTarget(null);
  await clearClosed;
  await rejected(f, `/${replacement}/`, {}, 502);
  f.proxy.setTarget({ origin: f.origin, token });
  const rotated = await stream(f);
  const rotateClosed = new Promise(resolve => rotated.res.once('close', resolve));
  const second = http.createServer((_req, res) => res.end('new upstream'));
  const secondPort = await listen(second);
  t.after(() => close(second));
  const listenerPort = f.proxy.port;
  f.proxy.setTarget({ origin: `http://127.0.0.1:${secondPort}`, token });
  await rotateClosed;
  assert.equal(f.proxy.port, listenerPort);
  const changed = await f.request();
  assert.equal(changed.status, 200);
  assert.equal(changed.body, 'new upstream');
});

test('stable short capability redirects to the current canvas and never upstreams', async t => {
  const f = await fixture(t);
  const shortCode = 'AbCdEfGhIjKlMnOp';
  const proxy = createCanvasProxy({ host: '127.0.0.1', port: 0, publicOrigin, shortCode });
  await proxy.start();
  t.after(() => proxy.stop());
  assert.equal((await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: proxy.port, path: `/s/${shortCode}`,
      headers: { host } }, res => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location }); })
      .on('error', reject);
  })).status, 502);
  proxy.setTarget({ origin: f.origin, token, url: `${f.origin}/${token}/d/demo/?view=2` });
  const before = f.seen.length;
  const redirected = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: proxy.port, path: `/s/${shortCode}`,
      headers: { host } }, res => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location }); })
      .on('error', reject);
  });
  assert.deepEqual(redirected, { status: 302, location: `${publicOrigin}/${token}/d/demo/?view=2` });
  assert.equal(f.seen.length, before);
  const get = path => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: proxy.port, path, headers: { host } }, res => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    }).on('error', reject);
  });
  assert.equal((await get('/s/wrongwrongwrong')).status, 404);
  assert.equal((await get(`/s/${shortCode}X`)).status, 404, 'prefix-extended code must not redirect');
  assert.equal((await get(`/s/${shortCode.slice(0, -1)}`)).status, 404, 'truncated code must not redirect');
  assert.equal((await get(`/s/${shortCode}/extra`)).status, 404, 'code with suffix path must not redirect');
  proxy.setTarget({ origin: f.origin, token });
  assert.equal((await get(`/s/${shortCode}`)).status, 404, 'target without a public path cannot redirect');
  await proxy.stop();
});

test('missing/unreachable target, bounded headers and aborted response are contained', { timeout: 12000 }, async t => {
  const f = await fixture(t);
  f.proxy.setTarget(null);
  await rejected(f, `/${token}/`, {}, 502);
  const unused = http.createServer();
  const port = await listen(unused);
  await close(unused);
  f.proxy.setTarget({ origin: `http://127.0.0.1:${port}`, token });
  await rejected(f, `/${token}/`, {}, 502);
  f.proxy.setTarget({ origin: f.origin, token });
  const hung = await f.request(`/${token}/hang`);
  assert.equal(hung.status, 502);
  assert.match(hung.body, canvasDown);
  const s = await stream(f, 'abort');
  assert.equal(s.chunk, 'partial');
  await new Promise(resolve => s.res.once('close', resolve));
  assert.equal((await f.request()).status, 201);
});

test('stop closes active streams, releases listener and is idempotent', { timeout: 2000 }, async t => {
  const f = await fixture(t);
  const port = f.proxy.port;
  const s = await stream(f);
  const closed = new Promise(resolve => s.res.once('close', resolve));
  await f.proxy.stop();
  await closed;
  await f.proxy.stop();
  assert.equal(f.proxy.port, null);
  const probe = http.createServer();
  probe.listen(port, '127.0.0.1');
  await once(probe, 'listening');
  await close(probe);
});

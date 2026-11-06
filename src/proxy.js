import http from 'node:http';

const errors = { 421: 'Misdirected Request\n', 404: 'Not Found\n', 403: 'Forbidden\n', 502: 'Bad Gateway\n' };
const hopHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection',
]);

function cleanHeaders(headers) {
  const blocked = new Set(hopHeaders);
  for (const name of String(headers.connection ?? '').split(',')) blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) =>
    !blocked.has(name) && name !== 'referer' && name !== 'forwarded' &&
    name !== 'x-real-ip' && !name.startsWith('x-forwarded-')));
}

function validateTarget(target) {
  if (target === null) return null;
  // URL.origin omits :80, so canonical loopback HTTP denotes that explicit default.
  const match = typeof target?.origin === 'string' && /^http:\/\/127\.0\.0\.1(?::([0-9]+))?$/.exec(target.origin);
  if (!match || Number(match[1] ?? 80) < 1 || Number(match[1] ?? 80) > 65535 ||
      typeof target.token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(target.token)) {
    throw new Error('Invalid canvas target');
  }
  const origin = new URL(target.origin).origin;
  let path;
  if (target.url !== undefined) {
    let parsed;
    try { parsed = new URL(target.url); } catch { throw new Error('Invalid canvas target'); }
    if (parsed.origin !== origin || !parsed.pathname.startsWith(`/${target.token}/`)) {
      throw new Error('Invalid canvas target');
    }
    path = `${parsed.pathname}${parsed.search}`;
  }
  return { origin, token: target.token, ...(path ? { path } : {}) };
}

// Inspect raw segments before URL normalization can hide traversal or token encoding.
function remainderFor(raw, token) {
  const path = raw.split('?')[0];
  const segments = path.split('/');
  if (!raw.startsWith('/') || raw.includes('#') || segments[1] !== token) return null;
  try {
    for (const segment of segments) {
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || /[\\/\x00-\x1f\x7f]/.test(decoded)) return null;
    }
  } catch { return null; }
  return segments.slice(2).join('/');
}

function extendCsp(value, origin, publicOrigin) {
  const extend = policy => policy.split(';').map(directive => {
    const words = directive.trim().split(/\s+/);
    if (words[0].toLowerCase() !== 'frame-ancestors' || !words.includes(origin) ||
        words.includes("'none'") || words.includes(publicOrigin)) return directive;
    return `${directive.trimEnd()} ${publicOrigin}${directive.slice(directive.trimEnd().length)}`;
  }).join(';');
  return Array.isArray(value) ? value.map(extend) : extend(value);
}

/** Explicit endpoint only: registration and lifecycle serialization belong to the controller. */
export function createCanvasProxy({ host, port, publicOrigin, shortCode }) {
  if (typeof host !== 'string' || !host.trim() || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Invalid proxy endpoint');
  }
  const external = new URL(publicOrigin);
  if (!['http:', 'https:'].includes(external.protocol) || external.origin !== publicOrigin) {
    throw new Error('Invalid public origin');
  }
  if (shortCode !== undefined && (typeof shortCode !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(shortCode))) {
    throw new Error('Invalid short code');
  }
  let target = null;
  let boundPort = null;
  const sockets = new Set();
  const active = new Set();
  const server = http.createServer((req, res) => {
    const fail = status => {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(errors[status]);
      req.resume();
    };
    if (req.headers.host !== external.host) return fail(421);
    const current = target;
    if (shortCode && req.url === `/s/${shortCode}`) {
      if (!current?.path || req.method !== 'GET') return fail(current ? 404 : 502);
      res.writeHead(302, { location: `${publicOrigin}${current.path}`, 'cache-control': 'no-store' });
      return res.end();
    }
    if (!current) return fail(502);
    const remainder = remainderFor(req.url, current.token);
    if (remainder === null) return fail(404);
    const origin = req.headers.origin;
    const nullRead = req.method === 'GET' && (remainder.startsWith('files/') ||
      remainder === 'system.html' || remainder === 'assets/inspector.js');
    if (!(origin === publicOrigin || (origin === undefined && req.method === 'GET') ||
        (origin === 'null' && nullRead))) return fail(403);

    const headers = cleanHeaders(req.headers);
    headers.host = new URL(current.origin).host;
    if (origin === publicOrigin) headers.origin = current.origin;
    // Guarded values cannot be removed by a malicious Connection nomination.
    if (origin === 'null') headers.origin = 'null';
    const upstream = http.request(current.origin, {
      path: req.url, method: req.method, headers, agent: false,
    });
    let response;
    const cancel = () => {
      clearTimeout(timer);
      upstream.destroy();
      response?.destroy();
      res.destroy();
      active.delete(cancel);
    };
    const timer = setTimeout(() => {
      fail(502);
      upstream.destroy();
    }, 5000);
    timer.unref();
    active.add(cancel);
    res.on('close', cancel);
    res.on('error', cancel);
    req.on('aborted', cancel);
    req.on('error', cancel);
    upstream.on('error', () => {
      clearTimeout(timer);
      fail(502);
    });
    upstream.on('response', incoming => {
      response = incoming;
      clearTimeout(timer); // No body inactivity timeout: healthy SSE can be idle indefinitely.
      incoming.on('error', () => fail(502));
      incoming.on('aborted', () => fail(502));
      const outgoing = cleanHeaders(incoming.headers);
      if (outgoing['content-security-policy']) {
        outgoing['content-security-policy'] = extendCsp(outgoing['content-security-policy'], current.origin, publicOrigin);
      }
      res.writeHead(incoming.statusCode, outgoing);
      incoming.pipe(res);
    });
    req.pipe(upstream);
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return {
    get port() { return boundPort; },
    setTarget(next) {
      const validated = validateTarget(next);
      if (validated?.origin === target?.origin && validated?.token === target?.token && validated?.path === target?.path) return;
      target = validated;
      for (const cancel of active) cancel();
    },
    async start() {
      if (server.listening) return boundPort;
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      boundPort = server.address().port;
      return boundPort;
    },
    async stop() {
      const closed = new Promise(resolve => server.close(resolve));
      for (const cancel of active) cancel();
      for (const socket of sockets) socket.destroy();
      await closed;
      boundPort = null;
    },
  };
}

# Guarded canvas HTTP proxy

`src/proxy.js` provides a stable, explicitly bound HTTP listener for one registered
loopback canvas. It uses Node builtins and does not discover servers, execute
commands, import configuration, or expose a listener until `start()` is called.

## Controller interface

```js
const proxy = createCanvasProxy({ host, port, publicOrigin });
proxy.setTarget({ origin, token });
const actualPort = await proxy.start();
await proxy.stop();
```

The controller must serialize start/stop and supply validated configuration.
`port` reports the bound port, or `null` while stopped. Port zero is supported for
internal fixtures only; production configuration must require a fixed port.
Bind errors propagate without selecting a different port or killing any process.

`setTarget()` validates before replacing the current registration. The origin
must be exact IPv4 loopback HTTP with a port in 1–65535; canonical
`http://127.0.0.1` means port 80, matching `URL.origin` normalization. Credentials,
paths, queries, fragments and other hosts are rejected. Tokens match
`[A-Za-z0-9_-]{16,128}`. Invalid descriptors throw `Invalid canvas target`.
Changing origin/token or setting `null` closes active streams. Equivalent
registrations leave them running. The listener stays fixed during rotation.
Stop closes requests, responses and sockets, releases the listener and is
idempotent; it retains registration for a later explicit start.

## Request boundary

| Check | Policy | Failure |
| --- | --- | --- |
| Host | Exact `new URL(publicOrigin).host` | 421 `Misdirected Request` |
| Registration | Current trusted target required | 502 `Bad Gateway` |
| Path | Raw first segment equals token; no absolute form, traversal or backslash tricks | 404 `Not Found` |
| Origin | Exact public origin, except the reads below | 403 `Forbidden` |
| Upstream | Connect and receive response headers within five seconds | 502 `Bad Gateway` |

Error bodies are the table text followed by one newline, with no request or
target details. HEAD responses have no body. Checks execute in table order.
Only GET may omit Origin. GET with `Origin: null` is allowed only for remainder
`files/...`, `system.html` or `assets/inspector.js`; null is preserved upstream.
All other allowed requests require the exact public origin, rewritten to the
upstream origin. Method handling remains upstream-owned, including 405/Allow.

The full token path, query, method and body are forwarded. Host is rewritten;
Referer, hop-by-hop headers (including Connection-nominated fields), Forwarded,
X-Forwarded-* and X-Real-IP are stripped. Response hop-by-hop headers are also
stripped. The proxy adds no CORS permissions. Only a CSP `frame-ancestors`
directive containing the upstream origin gains the public origin; other
directives and `frame-ancestors 'none'` remain unchanged.

## Streams and deployment limits

Responses are piped without buffering. The header deadline is cleared when
headers arrive, so idle SSE remains open. Client disconnect cancels upstream;
upstream aborts terminate an already-started downstream response rather than
injecting an error body into it.

An explicit HTTPS public origin supports future TLS termination. The reverse
proxy must pass that external Host and the browser's Origin unchanged; forwarded
headers never establish trust. This module itself serves HTTP, not TLS.

This is not authentication or read-only sharing. Keep capability URLs private,
restrict the listener to trusted devices and do not expose it publicly. No
firewall changes or LAN binding are performed by the tests. App/compare URLs are
not rewritten, and real canvas/browser/second-device proof belongs to integration.

Run the loopback-only tests with `node --test test/proxy.test.js`.

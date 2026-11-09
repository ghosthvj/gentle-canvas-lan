# Guarded canvas proxy

`src/proxy.js` provides a fixed, explicitly bound HTTP listener for one registered
loopback canvas. It uses Node builtins only: no discovery, no commands, no
configuration and no socket until `start()` is called.

## Interface

```js
const proxy = createCanvasProxy({ host, port, publicOrigin, shortCode? });
proxy.setTarget({ origin, token, url? });
const actualPort = await proxy.start();
await proxy.stop();
```

`port` is the bound port, or `null` while stopped. Bind errors propagate without
selecting another port or killing another process; the controller serializes
start/stop.

`setTarget()` validates before replacing the current registration. The origin must be
exact IPv4 loopback HTTP with a port in `1`–`65535` (a canonical `http://127.0.0.1`
means port 80). Credentials, paths, queries, fragments and other hosts are rejected,
and tokens match `[A-Za-z0-9_-]{16,128}`. Invalid descriptors throw
`Invalid canvas target`. Changing the target, or setting `null`, closes active
streams; an equivalent registration leaves them running.

When `shortCode` is configured, `GET /s/<shortCode>` answers `302` to the registered
canvas path without reaching upstream. A missing or wrong code is `404`, no target is
`502`, and only `GET` redirects.

## Request boundary

| Check | Policy | Failure |
| --- | --- | --- |
| Host | Exact host of `publicOrigin` | `421` |
| Registration | A trusted target is required | `502` page |
| Path | Raw first segment equals the token; no absolute form, traversal or backslash tricks | `404` |
| Origin | Exact public origin, except the reads below | `403` |
| Upstream | Response headers within five seconds | `502` page |

Checks run in that order. Only `GET` may omit `Origin`. `Origin: null` is accepted
only for `files/...`, `system.html` and `assets/inspector.js`, and stays `null`
upstream; every other allowed request needs the exact public origin, which is
rewritten to the upstream origin. Methods, status codes and bodies stay
upstream-owned, including `405`/`Allow`.

Error responses carry only the table text plus a newline, with no request or target
details, and have no body on `HEAD`. The `502` is the exception: the port stays
reserved while the local canvas is gone, so a browser gets a short `text/html` page
saying the canvas is not running and how to bring it back.

The full token path, query, method and body are forwarded. `Host` is rewritten to the
upstream host. `Referer`, `Forwarded`, `X-Forwarded-*`, `X-Real-IP` and hop-by-hop
headers (including `Connection`-nominated fields) are stripped in both directions,
and no CORS permission is added. Only a CSP `frame-ancestors` directive that contains
the upstream origin gains the public origin; other directives are untouched,
including `frame-ancestors 'none'`.

## Streams and limits

Responses are piped without buffering. The header deadline is cleared once headers
arrive, so an idle SSE stream stays open. A client disconnect cancels the upstream
request; an upstream abort after the response started terminates it instead of
injecting an error body.

An `https` public origin allows TLS termination in front of this listener: the
reverse proxy must forward that external `Host` and the browser's `Origin`. Forwarded
headers never establish trust, and this module serves HTTP only.

There is no authentication and sharing is not read-only. Keep capability URLs
private, restrict the listener to trusted devices and never expose it publicly.

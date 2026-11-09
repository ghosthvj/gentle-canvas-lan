# Session controller

`createController({config, createProxy?})` in `src/controller.js` connects the
validated canvas registry to the HTTP proxy. Construction opens no sockets.
The injected proxy factory is for deterministic lifecycle tests; production uses
`createCanvasProxy`.

## Operations

- `openCanvas(url)`: validate and replace the current registration, update the
  proxy target, and start lazily unless explicitly stopped. Invalid registration
  leaves the previous target unchanged. The selected design path and query are
  retained in the reported LAN URL.
- `start()`: explicitly enable the listener and return its current state. An
  upstream is optional; requests without a live one receive the proxy's
  explained 502 page. Callers must not advertise a link from this state alone:
  use `checkCanvas()` first.
- `checkCanvas()`: probe the registered canvas once (injectable `probeCanvas`,
  any HTTP answer counts) and, when it no longer answers, revoke the
  registration and clear the proxy target so no stale link stays advertised.
  Returns a boolean; idempotent and safe to call before `status()`.
- `status()`: return `{running, enabled, port, localUrl, lanUrl, shortUrl}` where `shortUrl` is a stable per-session `/s/<16-hex>` capability that redirects to the current canvas. Addresses are
  capability URLs; do not persist this object in request logs.
- `clearCanvas()`: revoke the registration and close stale upstream streams,
  keeping the listener available for later registration.
- `stop()`: disable automatic startup immediately, invalidate pending starts,
  close the listener and return the stopped state. Repeated stop is safe.
- `shutdown()`: clear registration and permanently dispose this controller.
  Later starts/registrations cannot revive a disposed session.

Lifecycle work runs in order. A stop invalidates pending startup before its
cleanup is queued, so a listener that finishes starting late is immediately
closed rather than published as running. Concurrent starts share the resulting
listener. A failed bind does not poison the queue; a later explicit start can
recover. Bind errors propagate without killing another process or changing the
configured port.

Changing a canvas port/token updates the target, not the listener. The proxy
closes active streams on target replacement and rejects the old token. Explicit
stop retains a valid registration for a later start, whereas shutdown clears it.

## Checks and limits

Run `node --test test/controller.test.js`. Tests include deterministic startup
interleavings and an actual occupied loopback port. Real canvas integration,
extension event wiring and access from a second device remain separate checks.
The controller does not configure networking, terminate TLS or authenticate LAN
clients. It must receive validated configuration from `readConfig`.

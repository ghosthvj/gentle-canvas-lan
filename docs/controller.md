# Controller

`createController({config, createProxy?, probeCanvas?})` binds one validated canvas
registry to the HTTP proxy and serializes the listener lifecycle. No socket opens at
construction time. `createProxy` and `probeCanvas` are injection seams for tests.

## Operations

- `openCanvas(url)` — validate and replace the registration, point the proxy at it,
  and start unless the listener was stopped. An invalid URL leaves the previous
  target untouched.
- `start()` — enable and bind the listener, then return the state. A missing upstream
  is allowed: requests receive the proxy's explained `502` page.
- `checkCanvas()` — probe the registration once (any HTTP answer counts). When
  nothing answers, revoke it and clear the proxy target so no stale link is
  advertised. Returns a boolean and is safe to repeat.
- `status()` — `{running, enabled, port, localUrl, lanUrl, shortUrl}`. `shortUrl` is
  the stable `/s/<16-hex>` capability for this session and redirects to whichever
  canvas is registered.
- `clearCanvas()` — drop the registration and the proxy target, keeping the listener.
- `stop()` — disable automatic startup, invalidate pending starts, close the listener.
- `shutdown()` — clear the registration and dispose the controller permanently.

## Guarantees

Lifecycle work is queued in order. A stop invalidates a pending start, so a listener
that finishes binding late is closed instead of published as running. Concurrent
starts share one listener, and a failed bind does not poison the queue: a later
explicit start can recover. Bind errors propagate without choosing another port or
touching another process.

Rotating the canvas updates the target, never the listener, and closes the active
streams of the previous canvas. `stop()` keeps a valid registration for a later
start; `shutdown()` clears it.

## Limits

The controller does not configure networking, terminate TLS or authenticate clients,
and it expects configuration validated by `readConfig`. `status()` carries capability
URLs: do not log or persist it.

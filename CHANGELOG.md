# Changelog

## [0.1.2] - 2026-11-10

Security hardening of the LAN-exposed proxy, from the 2026-11 security audit
(issues #4–#9, PRs #10–#16).

- Path segments are decoded iteratively before validation, so double-encoded dot
  segments such as `%252e%252e%252f` are rejected instead of forwarded; capability
  strings (token path prefix, short code) are compared with `timingSafeEqual`.
- Request bodies forwarded upstream are capped (default 50 MB): declared
  `content-length` over the cap answers `413` before any upstream connection, and
  chunked bodies are cut at the cap while streaming. A client body still arriving
  after the response finished no longer holds the upstream request open. The cap
  is configurable via `GENTLE_CANVAS_LAN_MAX_BODY_BYTES`.
- Concurrent client connections are capped (default 64, configurable via
  `GENTLE_CANVAS_LAN_MAX_CONNECTIONS`); sockets beyond the cap are destroyed
  before request handling.
- Capability failures (wrong host, origin, token or short code) are counted per
  client address; past 30 within a 60 s window the same rejection answers `429`.
  Legitimate requests are never counted, so valid traffic is never throttled.
- Persisted settings write their temp file exclusively: a pre-planted symlink at
  the temp path now fails the save instead of being written through.
- A hostname public origin must resolve when settings are saved, and
  `/canvas-lan:status` reports where it points — the bind IP (direct exposure),
  another private address (reverse proxy), or a public address (warning).
  Reverse-proxy topologies keep working. See `docs/public-origin.md`.
- Docs: `README.md` gained the two cap variables, and `docs/configuration.md`,
  `docs/proxy.md` and the new `docs/public-origin.md` document the guards.

## [0.1.1] - 2026-11-09

- Changing the bind port no longer drops the registered canvas: saving the setup
  modal rebuilds the listener and replays the current canvas onto it, so the next
  `/canvas-lan:start` serves it instead of answering `502`.
- The stable short link is only reported while a canvas is registered.

## [0.1.0] - 2026-11-09

First published version.

- Fixed LAN listener for the Gentle Design canvas, with a stable short link that
  redirects to whichever canvas is currently registered.
- Canvas registrations are probed before a link is advertised; a dead canvas is
  revoked instead of being forwarded to. Requests with no live canvas get a short
  page that explains the canvas is not running, instead of a bare `502`.
- Setup modal: `esc` cancels on terminals that report extended key sequences
  (kitty, modifyOtherKeys), and the `save` / `next` / `cancel` hints are clickable
  with the shell's shared hover treatment.
- Command feedback is durable in the TUI: status readouts, command results and
  errors are appended to the transcript instead of the single-slot status line.
- Commands are registered in lifecycle order: `setup`, `start`, `status`, `stop`.
- Breaking (development only): the bind variable is now `GENTLE_CANVAS_LAN_IP`
  (`GENTLE_CANVAS_LAN_HOST` is no longer read) and the persisted settings key is
  `ip`; an existing `host` key is read once and rewritten on the next save.
- Terminal text measurement counts text-presentation pictographs as one cell,
  keeping framed panels aligned.

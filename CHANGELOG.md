# Changelog

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

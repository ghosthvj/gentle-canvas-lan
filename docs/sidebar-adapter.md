# Sidebar adapter

`src/sidebar-adapter.js` exports `attachSidebar(tui, panel)`, which composes the
canvas panel into the shell's footer. It is a private compatibility adapter, not a
supported shell API: it returns `null` for an incompatible host, and the caller must
keep its public widget fallback. No installed package path is imported or modified.

## Host contract

The host must be in fullscreen mode and expose
`Symbol.for('gentle-pi.experimental-sidebar.state')` with a `parts` Map and a footer
that has `render(width)` and `invalidate()`. The panel implements the same two
methods and may provide `digest()` and `handleMouse(event)`. The adapter composes the
footer only: it builds no URLs and does not change the canvas's own local output.

## Attachment

- `isMounted()` — whether this attachment still belongs to the current terminal state
  and footer chain. Unknown newer wrappers report `false` so the caller can fall back
  to its widget.
- `isActive()` — whether the panel should be rendered: fullscreen, published
  `active === true`, ownership and visibility checks passing. Eligibility comes from
  `ownsHost()` rather than the transient `active` flag, which the shell resets while
  measuring a frame. When the host provides them, `ownsHost()` must return `true` and
  `statusHidden()` must return `false`; malformed policy hooks hide the panel.
  Inactive or narrow rails never render it.
- `invalidate()` — clears measured segments and asks the TUI to render. Update the
  panel's own data first; host-driven invalidation still reaches both components.
- `dispose()` — idempotent. It restores the previous footer only while this wrapper
  owns the slot, so a later owner is never overwritten.

The previous footer renders first at the supplied width, with its row groups and
loose rows preserved; the panel gets its own offset group so the shell frames it
separately. The adapter emits no colors, performs no I/O while rendering, and leaves
sizing and theme roles to the panel.

Mouse events are translated from the last rendered row heights to the child that owns
the pointer, preserving the other event fields. Hidden panels receive none.

Several canvas attachments compose in order and can be disposed in either order: a
disposed wrapper delegates to its predecessor without rendering the disposed panel.
A wrapper from another package may precede or follow this adapter, and it is never
modified.

## Limits

Host contract changes can disable this integration; callers must keep a working
fallback. The adapter does not mount itself, manage fallback widgets, discover links
or change shell preferences.

The footer composition pattern is adapted from MIT-licensed `mcp-sidebar`; see
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) for attribution.

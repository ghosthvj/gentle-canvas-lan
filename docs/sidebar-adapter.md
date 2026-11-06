# Guarded sidebar footer adapter

`src/sidebar-adapter.js` exports `attachSidebar(tui, panel)`. It returns `null`
for incompatible hosts or components; callers must retain their public widget
fallback. This is a private compatibility adapter, not a supported shell API.
No installed package paths are imported or modified.

The host must be fullscreen, with terminal-owned
`Symbol.for('gentle-pi.experimental-sidebar.state')`, a `parts` Map, and a footer
with `render(width)` and `invalidate()`. The panel implements those same methods
and may provide a string `digest()` and `handleMouse(event)`. The intended Canvas
panel displays **LAN only**; this adapter neither constructs URLs nor changes
Gentle Design's original local output.

## Attachment lifecycle

- `isMounted()` reports whether this attachment still belongs to the current
  terminal state and footer chain. Unknown newer wrappers conservatively report
  false, allowing the caller to select its fallback. In that case a captured
  Canvas wrapper delegates only its original footer rows, so a foreign wrapper
  cannot cause both a sidebar card and a fallback card to display the same URL.
- `isActive()` also requires fullscreen mode, `active === true`, and successful
  ownership and visibility checks. If present, `ownsHost()` must return `true`
  and `statusHidden()` must return `false`. Throwing or malformed policy hooks
  hide the panel. Inactive/narrow rails never render the panel.
- `invalidate()` changes the wrapper digest, clears measured segments, and asks
  the TUI to render. The panel owns its data/cache; update or invalidate that
  cache before calling this method. Host-driven footer invalidation continues
  to invalidate both live components.
- `dispose()` is idempotent. It restores the previous footer only while this
  wrapper still owns the slot. Later owners are never overwritten. Calls to
  `invalidate()` after disposal have no effect.

The previous footer renders first at the supplied width. Its row groups and
loose rows are preserved; the panel gets a separate offset group with an
exclusive end, so the shell theme frames the panel rather than the combined
footer. An ungrouped previous footer receives its own group. The adapter emits
no colors, performs no I/O in render, and leaves content sizing and semantic
theme roles to the panel.

Mouse events use the last rendered row heights, preserving other event fields
while translating `y` and `height` for the selected child. Invalidation clears
these measurements; hidden panels receive no events. Previous and panel string
digests participate in the wrapper digest. Missing, non-string or throwing
digests degrade to explicit invalidation rather than breaking serialization.

Multiple Canvas attachments compose in order and can be disposed in either
order. Disposed wrappers transparently delegate to their predecessor, without
rendering the disposed panel. Local wrapper metadata lets the final owner
restore the original directly. An MCP-style wrapper may precede or follow this
adapter; its private stack symbol is never accessed. A newer foreign wrapper
that captured this wrapper can keep calling it safely after disposal.

## Verification and limits

Run `node --test test/sidebar-adapter.test.js` for deterministic fake-TUI checks.
No real terminal session, themed screenshot, browser or LAN device is exercised
by these tests. Host contract changes may disable this integration; callers
must continue to support fallback display. This module does not mount itself,
manage fallback widgets, discover links or change shell preferences.

The footer composition pattern is adapted from MIT-licensed `mcp-sidebar`;
see `../THIRD_PARTY_NOTICES.md` for attribution and the full license.

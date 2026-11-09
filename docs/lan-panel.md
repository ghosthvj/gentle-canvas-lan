# LAN panel

`src/lan-panel.js` exports
`createLanPanel({ theme, truncateToWidth, visibleWidth, decorated?, actionLabel? })`,
the body of the sidebar card. The parent passes the active theme and text helpers;
the module has no dependencies, I/O or timers.

## Component contract

- `setUrl(url | null)` sets or clears the link. Clearing renders no rows. A value
  that is not a control-free `http(s)` URL without credentials throws `TypeError`
  with `Expected a control-free HTTP(S) LAN URL or null.` and keeps the previous URL.
  Accepted values are canonicalized with `URL#href`, so internationalized hostnames
  use IDNA and paths or queries are percent-encoded.
- `render(width)` returns styled rows:

  ```text
  ▾ CANVAS LAN
  - ▤ Open Design Canvas
  http://192.0.2.50:8098/s/0123456789abcdef
  ```

  The header flips to `▸` when collapsed. The action label carries an OSC 8
  destination for terminals that expose it, while the URL stays plain text so
  terminal Ctrl+click works. Rows are clipped without an ellipsis and the label is
  one row, never a wrapped fragment. Any positive width works, including one column;
  nonpositive or nonfinite widths render nothing.
  `decorated: false` drops the `- ▤ ` prefix and `actionLabel: false` shows only the
  header and URL, which the narrow fallback uses.
- `handleMouse(event)` toggles collapsed on a left click over the header row.
- `digest()` returns a JSON string of the current URL and collapsed state, or
  `[null,false]` when cleared.
- `invalidate()` is a no-op: theme roles are read on every render, so the adapter must
  redraw when the theme changes.

The extension normally passes the short `/s/<code>` link so the card fits one terminal
line; the full tokenized URL stays in `/canvas-lan:status` and in tool output. The
shell owns the surrounding rail, placement, visibility and fallback mounting.

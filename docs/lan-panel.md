# LAN panel renderer

`src/lan-panel.js` exports `createLanPanel({ theme, truncateToWidth, visibleWidth })`.
The parent supplies the active theme and terminal helpers from its host-resolved
Pi TUI import. This module has no runtime dependencies, I/O or timers.

## Component contract

- `setUrl(string | null)` sets the LAN URL or clears the component. Clearing renders
  `[]`, not an empty card. Invalid input throws `TypeError` with
  `Expected a control-free HTTP(S) LAN URL or null.` and preserves the previous URL.
- HTTP(S) URLs are canonicalized with `new URL(value).href`: internationalized
  hostnames use IDNA and Unicode paths/queries use percent-encoding. This preserves
  URL semantics, not literal Unicode spelling. Raw C0/C1 controls and DEL are
  rejected **before** parsing; URLs with credentials are also rejected. Validation
  of the configured LAN endpoint remains the configuration layer's responsibility.
- `render(width)` returns styled rows: a compact `CANVAS LAN` header followed by
  a `Open Design Canvas` (optionally decorated `- ▤ `) label whose OSC 8
  hyperlink target is the complete canonical LAN URL. The header is plain
  `▾ CANVAS LAN`/`▸ CANVAS LAN` so the native card applies its own glyph and
  title color; the document glyph lives in the body label. It never adds another address, frame, blank
  padding, shortcuts or clipboard affordances. The shell owns the surrounding rail.
- Every positive integer column budget is supported, including one column. The
  header and label clip without an ellipsis; the hidden hyperlink destination
  remains complete, including capability token, query and fragment. The label is
  a single row, never a wrapped fragment of the target. Nonpositive or
  nonfinite widths render no rows.
- `digest()` returns the canonical URL, or an empty string when cleared.
  `invalidate()` is a no-op because there is no rendering cache. Theme roles are
  read at render time: a dim bold header and accented link label. The owning adapter must
  arrange a redraw when the host theme changes; URL digest alone is not a theme key.

## Presentation limits

Opening the card link requires a terminal that supports OSC 8 hyperlinks (and
allows them through any terminal multiplexer). The entry passes Pi's detected
hyperlink capability into the panel. Without it, the action label stays visibly
underlined but the panel renders the complete canonical LAN URL as selectable
text beneath it; links are never emitted where the terminal would ignore them.
`/canvas:lan status` and the tool output always carry the plain URL. The parent owns sidebar availability, hidden/narrow rail
handling and fallback placement. This renderer does not claim inheritance of all
shell visual settings or implement the fallback widget itself.

Tests use deterministic injected theme/width helpers at 180, 48, 40, 20 and 1
columns, including long tokens, IPv6, Unicode normalization and live theme changes.
The parent separately checks the real Pi helper seam. No terminal screenshots were
captured: ttyd is unavailable, so these checks are structural, not visual proof.

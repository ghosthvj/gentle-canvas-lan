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
  a `Open Design Canvas` (optionally decorated `- ▤ `) label and the complete
  canonical LAN URL as plain wrapped text. The extension normally supplies a
  short stable LAN redirect instead, so the card link fits one terminal line. The label also carries an OSC 8
  destination for terminals that expose it, but plain URL text is the reliable
  Ctrl+click path in hosts such as Herdr. The plain URL rows follow the action label; labels are never explicitly
  underlined. The header is plain
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

Ctrl+click the visible URL. Herdr 0.9.5 exposes plain (including wrapped) URL
text to its Ctrl+click handler but did not expose this card's OSC 8 label in
practice, so the panel always renders the URL as selectable text; capability
detection alone was not a reliable proxy for clickability. `/canvas:lan status`
and the tool output also carry the plain URL. The parent owns sidebar availability, hidden/narrow rail
handling and fallback placement. This renderer does not claim inheritance of all
shell visual settings or implement the fallback widget itself.

Tests use deterministic injected theme/width helpers at 180, 48, 40, 20 and 1
columns, including long tokens, IPv6, Unicode normalization and live theme changes.
The parent separately checks the real Pi helper seam. No terminal screenshots were
captured: ttyd is unavailable, so these checks are structural, not visual proof.

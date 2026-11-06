const invalidUrl = 'Expected a control-free HTTP(S) LAN URL or null.';

/** A rail-owned, LAN-only component; terminal helpers come from the active host. */
export function createLanPanel({ theme, truncateToWidth, visibleWidth }) {
  let url = null;

  return {
    setUrl(value) {
      if (value === null) {
        url = null;
        return;
      }
      // Check before URL parsing: WHATWG parsing silently removes some controls.
      if (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/u.test(value)) {
        throw new TypeError(invalidUrl);
      }
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new TypeError(invalidUrl);
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new TypeError(invalidUrl);
      }
      // Serialize before putting the destination inside an OSC 8 control sequence.
      url = parsed.href;
    },

    render(width) {
      const columns = Math.floor(width);
      if (!url || !Number.isFinite(columns) || columns < 1) return [];
      const header = truncateToWidth('CANVAS LAN', columns, '');
      const label = truncateToWidth('Open canvas', columns, '');
      if (!label || visibleWidth(label) > columns) return [];
      // Display text is width-bounded, but the terminal opens the full target.
      // Never rely on auto-detection of a URL split/truncated by sidebar chrome.
      const link = `\x1b]8;;${url}\x1b\\${theme.fg('accent', label)}\x1b]8;;\x1b\\`;
      return [theme.fg('dim', theme.bold(header)), link];
    },

    // No paint cache: the active theme is consulted on every render.
    invalidate() {},
    digest() { return url ?? ''; },
  };
}

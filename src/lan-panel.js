const invalidUrl = 'Expected a control-free HTTP(S) LAN URL or null.';

/** A rail-owned, LAN-only component; terminal helpers come from the active host. */
export function createLanPanel({ theme, truncateToWidth, visibleWidth, decorated = false }) {
  let url = null;
  let collapsed = false;

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
      // Plain header: the native card extracts ▾/▸ and paints the title like
      // every other section; tinted rails print it verbatim.
      const header = truncateToWidth(`${collapsed ? '▸' : '▾'} CANVAS LAN`, columns, '');
      if (collapsed) return [header];
      const label = truncateToWidth(decorated ? '- ▤ Open Design Canvas' : 'Open Design Canvas', columns, '');
      if (!label || visibleWidth(label) > columns) return [];
      // Display text is width-bounded, but the terminal opens the full target.
      // Never rely on auto-detection of a URL split/truncated by sidebar chrome.
      const link = `\x1b]8;;${url}\x1b\\${theme.fg('accent', label)}\x1b]8;;\x1b\\`;
      return [header, link];
    },

    handleMouse(event) {
      if (!url || event.y !== 0 || event.x < 0 || event.x >= event.width || event.height < 1 || event.button !== 'left') return undefined;
      if (event.type === 'press') return { handled: true };
      if (event.type !== 'click') return undefined;
      collapsed = !collapsed;
      return { handled: true, render: true };
    },
    // No paint cache: the active theme is consulted on every render.
    invalidate() {},
    digest() { return JSON.stringify([url, collapsed]); },
  };
}

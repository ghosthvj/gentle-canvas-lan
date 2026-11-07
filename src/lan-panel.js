const invalidUrl = 'Expected a control-free HTTP(S) LAN URL or null.';

/** A rail-owned, LAN-only component; terminal helpers come from the active host. */
export function createLanPanel({ theme, truncateToWidth, visibleWidth, decorated = false, actionLabel = true }) {
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
      // Native cards paint headers with the INFO accent role; carrying the
      // normal text role and weight here matches the other panels' titles.
      const styledHeader = theme.fg('text', theme.bold(header));
      if (collapsed) return [styledHeader];
      const prefix = truncateToWidth(decorated ? '- ▤ ' : '', columns, '');
      const prefixWidth = visibleWidth(prefix);
      const label = truncateToWidth('Open Design Canvas', Math.max(1, columns - prefixWidth), '');
      const action = theme.fg('accent', label);
      const link = `\x1b]8;;${url}\x1b\\${action}\x1b]8;;\x1b\\`;
      const rows = [styledHeader];
      const urlRows = [];
      // Terminal hosts differ: Herdr exposes plain URL text to Ctrl+click but
      // not always OSC 8, so always show the complete capability as text too.
      for (let offset = 0; offset < url.length;) {
        // Slice raw text first: splitting a styled string could cut an ANSI code.
        const chunk = truncateToWidth(url.slice(offset, offset + columns), columns, '');
        if (!chunk) break;
        urlRows.push(theme.fg('accent', chunk));
        offset += chunk.length;
      }
      const labelRow = label && visibleWidth(label) <= columns - prefixWidth ? prefix + link : undefined;
      if (labelRow && actionLabel) rows.push(labelRow);
      return [...rows, ...urlRows];
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

const invalidUrl = 'Expected a control-free HTTP(S) LAN URL or null.';

/** A rail-owned, LAN-only component; terminal helpers come from the active host. */
export function createLanPanel({ theme, truncateToWidth, visibleWidth, decorated = false, hyperlinks = true }) {
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
      if (!label || visibleWidth(label) > columns - prefixWidth) return [];
      const underline = theme.underline ?? (text => text);
      const action = theme.fg('accent', underline(label));
      if (!hyperlinks) {
        // Terminal ignores OSC 8: expose the full capability as selectable text.
        const rows = [styledHeader, prefix + action];
        const plain = theme.fg('accent', url);
        for (let offset = 0; offset < plain.length;) {
          const chunk = truncateToWidth(plain.slice(offset, offset + columns), columns, '');
          if (!chunk) break;
          rows.push(chunk);
          offset += chunk.length;
        }
        return rows;
      }
      // Only the action text is underlined; decoration stays outside the link.
      const link = `\x1b]8;;${url}\x1b\\${action}\x1b]8;;\x1b\\`;
      return [styledHeader, prefix + link];
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

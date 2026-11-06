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
      // IDNA and percent-encoding make even one-column wrapping lossless.
      url = parsed.href;
    },

    render(width) {
      const columns = Math.floor(width);
      if (!url || !Number.isFinite(columns) || columns < 1) return [];
      const header = truncateToWidth('CANVAS LAN', columns, '');
      const rows = [theme.fg('dim', theme.bold(header))];
      for (let offset = 0; offset < url.length;) {
        // Serialized HTTP(S) URLs are ASCII. Bound each slice before measuring
        // so render work stays linear even for a very long capability URL.
        const chunk = truncateToWidth(url.slice(offset, offset + columns), columns, '');
        if (!chunk || visibleWidth(chunk) > columns) {
          throw new RangeError('Terminal helpers could not fit the serialized LAN URL.');
        }
        rows.push(theme.fg('accent', chunk));
        offset += chunk.length;
      }
      return rows;
    },

    // No paint cache: the active theme is consulted on every render.
    invalidate() {},
    digest() { return url ?? ''; },
  };
}

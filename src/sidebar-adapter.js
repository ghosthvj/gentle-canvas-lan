// Footer composition adapted from mcp-sidebar (MIT); see THIRD_PARTY_NOTICES.md.
const STATE = Symbol.for('gentle-pi.experimental-sidebar.state');
// Local metadata only: never claim the MCP extension's private stack key.
const wrappers = new WeakMap();
const isComponent = value => value && typeof value.render === 'function'
  && typeof value.invalidate === 'function';

function digest(component) {
  try {
    const value = component.digest?.();
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function liveOriginal(component) {
  let entry = wrappers.get(component);
  while (entry?.disposed) {
    component = entry.original;
    entry = wrappers.get(component);
  }
  return component;
}

/** Append a theme-neutral card to a compatible private Gentle Shell footer. */
export function attachSidebar(tui, panel) {
  if (tui?.mode !== 'fullscreen' || !tui.terminal || !isComponent(panel)) return null;
  const terminal = tui.terminal;
  const host = terminal[STATE];
  if (!host || !(host.parts instanceof Map)) return null;
  const original = liveOriginal(host.parts.get('footer'));
  if (!isComponent(original)) return null;

  const entry = { original, disposed: false };
  let revision = 0;
  let rendered;
  const active = () => {
    if (entry.disposed || !mounted() || tui.mode !== 'fullscreen' || tui.terminal !== terminal
      || terminal[STATE] !== host) return false;
    try {
      // During layout preparation the shell resets active before measuring
      // parts. Eligibility must come from ownsHost, not that output flag.
      if (host.ownsHost !== undefined) {
        if (typeof host.ownsHost !== 'function' || host.ownsHost() !== true) return false;
      } else if (host.active !== true) return false;
      // Unknown policy values and throwing hooks fail closed.
      if (host.statusHidden !== undefined && (typeof host.statusHidden !== 'function'
        || host.statusHidden() !== false)) return false;
      return true;
    } catch {
      return false;
    }
  };
  const mounted = () => {
    if (entry.disposed || tui.terminal !== terminal || terminal[STATE] !== host) return false;
    let current = host.parts.get('footer');
    while (current) {
      if (current === wrapper) return true;
      current = wrappers.get(current)?.original;
    }
    return false;
  };
  const requestRender = () => tui.requestRender?.();
  const wrapper = {
    ...(original.surface === 'panel' ? { surface: 'panel' } : {}),
    render(width) {
      const rows = [...original.render(width)];
      const visible = active();
      const panelRows = visible ? [...panel.render(width)] : [];
      rendered = { width, visible, previousHeight: rows.length, panelHeight: panelRows.length };
      return [...rows, ...panelRows];
    },
    cardGroups(width) {
      if (entry.disposed) return original.cardGroups?.(width);
      if (!rendered || rendered.width !== width || rendered.visible !== active()) wrapper.render(width);
      const previous = original.cardGroups?.(width);
      const groups = previous ? previous.groups.map(group => ({ ...group }))
        : rendered.previousHeight ? [{ start: 0, end: rendered.previousHeight }] : [];
      if (rendered.panelHeight) {
        groups.push({ start: rendered.previousHeight, end: rendered.previousHeight + rendered.panelHeight });
      }
      return { groups, loose: [...(previous?.loose ?? [])] };
    },
    invalidate() {
      revision++;
      rendered = undefined;
      original.invalidate();
      if (!entry.disposed) panel.invalidate();
    },
    digest() {
      if (entry.disposed) return digest(original);
      const visible = active();
      return JSON.stringify([digest(original), revision, visible, visible ? digest(panel) : '']);
    },
    handleMouse(event) {
      if (entry.disposed) return original.handleMouse?.(event);
      if (!rendered || event.y < 0 || event.y >= event.height) return undefined;
      let result;
      if (event.y < rendered.previousHeight) {
        result = original.handleMouse?.({ ...event, height: rendered.previousHeight });
      } else if (active() && event.y < rendered.previousHeight + rendered.panelHeight) {
        result = panel.handleMouse?.({ ...event, y: event.y - rendered.previousHeight,
          height: rendered.panelHeight });
      }
      if (result?.render) revision++;
      return result;
    },
  };
  wrappers.set(wrapper, entry);
  host.parts.set('footer', wrapper);
  requestRender();

  return {
    isMounted: mounted,
    isActive: () => host.active === true && mounted() && active(),
    invalidate() {
      if (entry.disposed) return;
      revision++;
      rendered = undefined;
      requestRender();
    },
    dispose() {
      if (entry.disposed) return;
      entry.disposed = true;
      rendered = undefined;
      // Never overwrite a later owner, including a separately loaded extension.
      if (host.parts.get('footer') === wrapper) host.parts.set('footer', liveOriginal(original));
      requestRender();
    },
  };
}

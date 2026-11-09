// Setup form rendered as a centered overlay panel. The frame, the field editor
// and the measurement are local: hosts only guarantee overlay support, and some
// expose just a slice of the TUI module, never the input component.
import { truncateToWidth, visibleWidth } from './text-fit.js';

const FIELDS = [
  { key: 'host', label: 'Host / IP to bind', placeholder: '192.168.1.20' },
  { key: 'port', label: 'Port', placeholder: '34316' },
  { key: 'publicOrigin', label: 'Public origin (optional; empty clears)', placeholder: 'https://canvas.example' },
];
const HINTS = [
  ['enter', 'save', 'save'],
  ['tab', 'next', 'next'],
  ['esc', 'cancel', 'cancel'],
];
// The shell paints every clickable surface with one shared hover role.
const HOVER_ROLE = 'warning';
// Extended key protocols never send a bare ESC: kitty reports `CSI <code>;<mods>u`
// and modifyOtherKeys reports `CSI 27;<mods>;27~`. Decode them here so the modal
// does not depend on the host exposing its key matcher.
const CSI_U = /^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?u$/;
const MODIFY_OTHER = /^\x1b\[27;(\d+)(?::(\d+))?;(\d+)~$/;
const SEMANTIC = { 27: 'escape', 13: 'enter', 9: 'tab', 127: 'backspace', 99: 'ctrl+c' };
const extendedKey = data => {
  if (typeof data !== 'string') return null;
  const csi = CSI_U.exec(data);
  if (csi) {
    const code = Number(csi[1]);
    const mods = Number(csi[2] ?? 1);
    if (code === 9 && mods === 2) return 'shift+tab';
    if (code === 99 && mods === 5) return 'ctrl+c';
    return mods === 1 ? SEMANTIC[code] ?? null : null;
  }
  const other = MODIFY_OTHER.exec(data);
  return other ? SEMANTIC[Number(other[3])] ?? null : null;
};
// Below this width the frame would leave too little room for the values.
const FRAME_MIN_WIDTH = 30;
const TITLE = '▤ Canvas LAN setup';
const HINT_GAP = '   ';
const CARET = '▏';

const editKeys = (data, is) => {
  if (is(data, 'backspace', '\x7f')) return 'backspace';
  if (is(data, 'delete', '\x1b[3~')) return 'delete';
  if (is(data, 'left', '\x1b[D')) return 'left';
  if (is(data, 'right', '\x1b[C')) return 'right';
  if (is(data, 'home', '\x1b[H', '\x1b[1~', '\x01')) return 'home';
  if (is(data, 'end', '\x1b[F', '\x1b[4~', '\x05')) return 'end';
  return null;
};

const printable = data => typeof data === 'string' && data.length > 0
  && ![...data].some(char => {
    const code = char.codePointAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });

export function createSetupPanel({ theme, values = {}, validate = () => null, submit, cancel, requestRender = () => {}, matchesKey }) {
  // The host's matcher understands every encoding it enables; the local decoder
  // covers the extended protocols even when the host exposes no matcher.
  const keyMatches = typeof matchesKey === 'function' ? matchesKey : () => false;
  const is = (data, id, ...raw) => raw.includes(data) || extendedKey(data) === id || keyMatches(data, id);
  const fields = FIELDS.map(field => {
    const initial = typeof values[field.key] === 'string' ? values[field.key] : '';
    return { ...field, value: initial, caret: [...initial].length };
  });
  let active = 0;
  let error = null;
  let closed = false;
  // Click targets recorded while rendering: a hint row is the only affordance
  // with a mouse action, so each `key label` group knows its columns.
  let hintHits = [];
  let hoveredAction = null;

  const snapshot = () => Object.fromEntries(fields.map(field => [field.key, field.value]));

  const move = step => {
    active = (active + step + fields.length) % fields.length;
    fields[active].caret = [...fields[active].value].length;
    error = null;
    requestRender();
  };

  const edit = action => {
    const field = fields[active];
    const chars = [...field.value];
    if (action === 'backspace' && field.caret > 0) {
      chars.splice(field.caret - 1, 1);
      field.caret -= 1;
    } else if (action === 'delete' && field.caret < chars.length) {
      chars.splice(field.caret, 1);
    } else if (action === 'left') {
      field.caret = Math.max(0, field.caret - 1);
    } else if (action === 'right') {
      field.caret = Math.min(chars.length, field.caret + 1);
    } else if (action === 'home') {
      field.caret = 0;
    } else if (action === 'end') {
      field.caret = chars.length;
    }
    field.value = chars.join('');
  };

  const finish = () => {
    const next = snapshot();
    let message = null;
    try {
      message = validate(next) ?? null;
    } catch (thrown) {
      message = typeof thrown?.message === 'string' && thrown.message ? thrown.message : 'Invalid settings.';
    }
    if (message) {
      error = message;
      requestRender();
      return;
    }
    closed = true;
    submit(next);
  };

  const handleInput = data => {
    if (closed) return;
    if (is(data, 'escape', '\x1b') || is(data, 'ctrl+c', '\x03')) {
      closed = true;
      cancel();
      return;
    }
    if (is(data, 'tab', '\t') || is(data, 'down', '\x1b[B')) return move(1);
    if (is(data, 'shift+tab', '\x1b[Z') || is(data, 'up', '\x1b[A')) return move(-1);
    if (is(data, 'enter', '\r', '\n')) return finish();
    const action = editKeys(data, is);
    if (action) {
      error = null;
      edit(action);
      requestRender();
      return;
    }
    if (!printable(data)) return;
    const field = fields[active];
    const chars = [...field.value];
    chars.splice(field.caret, 0, ...data);
    field.value = chars.join('');
    field.caret += [...data].length;
    error = null;
    requestRender();
  };

  // Focused field: value around a visible caret; empty field: dim placeholder.
  const fieldRow = (field, columns) => {
    const focused = field === fields[active];
    const chars = [...field.value];
    if (!chars.length) {
      if (focused) return theme.fg('accent', CARET);
      return field.placeholder ? theme.fg('dim', field.placeholder) : '';
    }
    if (!focused) return truncateToWidth(field.value, columns, '…');
    const before = chars.slice(0, field.caret).join('');
    const after = chars.slice(field.caret).join('');
    const caret = theme.fg('accent', CARET);
    if (visibleWidth(before) >= columns) return truncateToWidth(`${before}${caret}`, columns, '…');
    return before + caret + truncateToWidth(after, Math.max(0, columns - visibleWidth(before) - 1), '…');
  };

  // A hint row is the only affordance with a mouse action, so rendering also
  // records the exact columns each `key label` group occupies.
  const hintRow = (startColumn, joiner, labels) => {
    const parts = [];
    const hits = [];
    let column = startColumn;
    for (const [key, label, action] of HINTS) {
      const hovered = action === hoveredAction;
      const keyText = theme.bold(key);
      const labelText = labels ? ` ${label}` : '';
      const text = hovered
        ? theme.fg(HOVER_ROLE, keyText + labelText)
        : theme.fg('accent', keyText) + (labels ? theme.fg('dim', labelText) : '');
      const span = key.length + (labels ? 1 + label.length : 0);
      hits.push({ action, row: null, start: column, end: column + span });
      parts.push(text);
      column += span + joiner.length;
    }
    return { text: parts.join(theme.fg('dim', joiner)), hits };
  };

  const compact = width => {
    const rows = [
      theme.fg('accent', theme.bold(TITLE)),
      ...fields.map(field => truncateToWidth(`${field.label}: ${field.value}`, width, '…')),
      ...(error ? [truncateToWidth(`⚠ ${error}`, width, '…')] : []),
    ];
    const hint = hintRow(0, ' · ', false);
    hintHits = hint.hits.map(hit => ({ ...hit, row: rows.length }));
    rows.push(theme.fg('dim', truncateToWidth(hint.text, width, '…')));
    return rows;
  };

  const render = width => {
    const columns = Math.floor(width);
    if (!Number.isFinite(columns) || columns < 1) return [];
    if (columns < FRAME_MIN_WIDTH) return compact(columns);
    const inner = columns - 2;
    const edge = text => theme.fg('border', text);
    const fit = text => {
      const clipped = truncateToWidth(text, inner, '…');
      return clipped + ' '.repeat(Math.max(0, inner - visibleWidth(clipped)));
    };
    const line = content => edge('│') + fit(`  ${content}`) + edge('│');
    const titleWidth = visibleWidth(TITLE);
    const rest = Math.max(0, columns - 5 - titleWidth);
    const rows = [
      edge('╭─ ') + theme.fg('accent', theme.bold(TITLE)) + ' ' + edge(`${'─'.repeat(rest)}╮`),
      line(''),
    ];
    for (const [index, field] of fields.entries()) {
      const selected = index === active;
      rows.push(line(theme.fg(selected ? 'accent' : 'muted', `${selected ? '▸' : ' '} ${field.label}`)));
      rows.push(line(fieldRow(field, Math.max(1, inner - 3))));
      if (index < fields.length - 1) rows.push(line(''));
    }
    rows.push(line(''));
    if (error) {
      rows.push(line(theme.fg('error', `⚠ ${error}`)));
      rows.push(line(''));
    }
    // x = left border (1) + the two-space inner pad.
    const hint = hintRow(3, HINT_GAP, true);
    hintHits = hint.hits.map(hit => ({ ...hit, row: rows.length }));
    rows.push(line(hint.text));
    rows.push(line(''));
    rows.push(edge('╰' + '─'.repeat(Math.max(0, columns - 2)) + '╯'));
    return rows;
  };

  const hitAt = (x, y) => hintHits.find(({ row, start, end }) => y === row && x >= start && x < end);

  const handleMouse = event => {
    if (closed || !event) return undefined;
    // A plain pointer move only repaints the hover treatment.
    if (event.type === 'move') {
      const next = hitAt(event.x, event.y)?.action ?? null;
      if (next === hoveredAction) return undefined;
      hoveredAction = next;
      requestRender();
      return { handled: true, render: true };
    }
    if (event.button !== 'left' || (event.type !== 'press' && event.type !== 'click')) return undefined;
    const hit = hitAt(event.x, event.y);
    if (!hit) return undefined;
    if (event.type === 'press') return { handled: true, focus: true };
    if (hit.action === 'save') finish();
    else if (hit.action === 'next') move(1);
    else {
      closed = true;
      cancel();
    }
    return { handled: true };
  };

  return {
    handleInput,
    handleMouse,
    render,
    // No paint cache: the theme is consulted on every render.
    invalidate() {},
  };
}

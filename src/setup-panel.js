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
  ['enter', 'save'],
  ['tab', 'next'],
  ['esc', 'cancel'],
];
// Below this width the frame would leave too little room for the values.
const FRAME_MIN_WIDTH = 30;
const TITLE = '▤ Canvas LAN setup';
const HINT_GAP = '   ';
const CARET = '▏';

const editKeys = data => {
  if (data === '\x7f') return 'backspace';
  if (data === '\x1b[3~') return 'delete';
  if (data === '\x1b[D') return 'left';
  if (data === '\x1b[C') return 'right';
  if (data === '\x1b[H' || data === '\x1b[1~' || data === '\x01') return 'home';
  if (data === '\x1b[F' || data === '\x1b[4~' || data === '\x05') return 'end';
  return null;
};

const printable = data => typeof data === 'string' && data.length > 0
  && ![...data].some(char => {
    const code = char.codePointAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });

export function createSetupPanel({ theme, values = {}, validate = () => null, submit, cancel, requestRender = () => {} }) {
  const fields = FIELDS.map(field => {
    const initial = typeof values[field.key] === 'string' ? values[field.key] : '';
    return { ...field, value: initial, caret: [...initial].length };
  });
  let active = 0;
  let error = null;
  let closed = false;

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
    if (data === '\x1b' || data === '\x03') {
      closed = true;
      cancel();
      return;
    }
    if (data === '\t' || data === '\x1b[B') return move(1);
    if (data === '\x1b[Z' || data === '\x1b[A') return move(-1);
    if (data === '\r' || data === '\n') return finish();
    const action = editKeys(data);
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

  const compact = width => [
    theme.fg('accent', theme.bold(TITLE)),
    ...fields.map(field => truncateToWidth(`${field.label}: ${field.value}`, width, '…')),
    ...(error ? [truncateToWidth(`⚠ ${error}`, width, '…')] : []),
    theme.fg('dim', truncateToWidth(HINTS.map(([key]) => key).join(' · '), width, '…')),
  ];

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
    rows.push(line(HINTS
      .map(([key, label]) => theme.fg('accent', theme.bold(key)) + theme.fg('dim', ` ${label}`))
      .join(theme.fg('dim', HINT_GAP))));
    rows.push(line(''));
    rows.push(edge('╰' + '─'.repeat(Math.max(0, columns - 2)) + '╯'));
    return rows;
  };

  return {
    handleInput,
    render,
    // No paint cache: the theme is consulted on every render.
    invalidate() {},
  };
}

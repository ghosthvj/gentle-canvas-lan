import test from 'node:test';
import assert from 'node:assert/strict';
import { createSetupPanel } from '../src/setup-panel.js';
import { visibleWidth } from '../src/text-fit.js';

// Styled rows are measured with the real text-fit module; assertions read the
// unstyled text.
const unstyle = text => text.replace(/\x1b\[[0-9;]*m/g, '');
const plainRows = (panel, width) => panel.render(width).map(unstyle);
// Only the active field renders a caret, so its row pinpoints focus and caret.
const caretRow = (panel, width) => plainRows(panel, width).find(row => row.includes('▏'));
const focusOn = (panel, width, label) =>
  plainRows(panel, width).some(row => row.includes(`▸ ${label}`));

function fakeTheme() {
  const paints = [];
  return {
    paints,
    fg(role, text) {
      paints.push([role, text]);
      return `\x1b[3${(['accent', 'border', 'error', 'muted', 'dim', 'text'].indexOf(role) % 7)}m${text}\x1b[0m`;
    },
    bold: text => `\x1b[1m${text}\x1b[0m`,
  };
}

function fixture({ values, validate, initial = { host: '192.168.1.20', port: '34316', publicOrigin: '' } } = {}) {
  const submitted = [];
  const cancelled = [];
  const theme = fakeTheme();
  let renders = 0;
  const panel = createSetupPanel({
    theme,
    values: { ...initial, ...values },
    validate: validate ?? (() => null),
    submit: next => submitted.push(next),
    cancel: () => cancelled.push(true),
    requestRender: () => { renders++; },
  });
  return { panel, submitted, cancelled, theme, renders: () => renders };
}

test('renders a framed form with title, labels and current values', () => {
  const { panel } = fixture();
  for (const width of [78, 60, 40, 30]) {
    const rows = panel.render(width);
    const plain = rows.map(unstyle);
    assert.equal(visibleWidth(rows[0]), width);
    assert.equal(plain[0].startsWith('╭─ ▤ Canvas LAN setup'), true);
    assert.equal(plain[0].endsWith('╮'), true);
    assert.equal(plain.at(-1).startsWith('╰'), true);
    assert.equal(plain.at(-1).endsWith('╯'), true);
    assert.ok(rows.every(row => visibleWidth(row) === width));
    const body = plain.join('\n');
    assert.match(body, /▸ Host \/ IP to bind/);
    assert.match(body, /Port/);
    assert.match(body, /Public origin/);
    assert.match(body, /192\.168\.1\.20/);
    assert.match(body, /34316/);
    if (width >= 40) {
      // At the 30-column minimum the hint row is truncated with an ellipsis.
      assert.match(body, /enter.*save/);
      assert.match(body, /tab.*next/);
      assert.match(body, /esc.*cancel/);
    }
  }
});

test('focus starts on the host, tab and arrows move it, and typing appends at the caret', () => {
  const { panel, submitted, renders } = fixture();
  // The caret starts at the end of each prefilled value.
  assert.match(caretRow(panel, 60), /192\.168\.1\.20▏/);
  assert.equal(focusOn(panel, 60, 'Host / IP to bind'), true);
  assert.equal(focusOn(panel, 60, 'Port'), false);
  panel.handleInput('9');
  assert.match(caretRow(panel, 60), /192\.168\.1\.209▏/);
  panel.handleInput('\t');
  assert.equal(focusOn(panel, 60, 'Port'), true);
  assert.equal(focusOn(panel, 60, 'Host / IP to bind'), false);
  // Moving focus puts the caret at the end of the newly focused value.
  assert.match(caretRow(panel, 60), /34316▏/);
  panel.handleInput('\x1b[A');
  assert.equal(focusOn(panel, 60, 'Host / IP to bind'), true);
  panel.handleInput('\x1b[B');
  assert.equal(focusOn(panel, 60, 'Port'), true);
  panel.handleInput('\x1b[Z');
  assert.equal(focusOn(panel, 60, 'Host / IP to bind'), true);
  // Shift-tab from the first field wraps to the last one; it is empty, so the
  // focused row shows only the caret, not a value.
  panel.handleInput('\x1b[Z');
  assert.equal(focusOn(panel, 60, 'Public origin'), true);
  const caretOnly = plainRows(panel, 60).some(row => row.includes('▏') && !/[^\s▏│]/u.test(row));
  assert.equal(caretOnly, true);
  assert.ok(renders() >= 5);
  assert.equal(submitted.length, 0);
});

test('enter submits every field value once and the panel stops accepting input', () => {
  const { panel, submitted, cancelled } = fixture();
  panel.handleInput('\t');
  panel.handleInput('9');
  panel.handleInput('\t');
  panel.handleInput('h');
  panel.handleInput('\r');
  assert.deepEqual(submitted, [{ host: '192.168.1.20', port: '343169', publicOrigin: 'h' }]);
  const closed = panel.render(60);
  panel.handleInput('\r');
  panel.handleInput('\t');
  panel.handleInput('x');
  panel.handleInput('\x1b');
  assert.equal(submitted.length, 1);
  assert.equal(cancelled.length, 0);
  assert.deepEqual(panel.render(60), closed);
});

test('backspace, delete and caret moves edit the focused value in place', () => {
  const { panel, submitted } = fixture();
  panel.handleInput('\t'); // focus the prefilled port
  assert.match(caretRow(panel, 60), /34316▏/);
  panel.handleInput('\x7f'); // backspace from the end
  assert.match(caretRow(panel, 60), /3431▏/);
  panel.handleInput('\x1b[D'); // left
  assert.match(caretRow(panel, 60), /343▏1/);
  panel.handleInput('\x1b[C'); // right, back to the end
  assert.match(caretRow(panel, 60), /3431▏/);
  panel.handleInput('\x01'); // home
  assert.match(caretRow(panel, 60), /▏3431/);
  panel.handleInput('\x1b[3~'); // delete at the caret
  assert.match(caretRow(panel, 60), /▏431/);
  panel.handleInput('\x05'); // end
  assert.match(caretRow(panel, 60), /431▏/);
  panel.handleInput('\r');
  assert.deepEqual(submitted, [{ host: '192.168.1.20', port: '431', publicOrigin: '' }]);
});

test('multi-character paste inserts every character at the caret', () => {
  const { panel, submitted } = fixture();
  const idle = () => panel.render(60);
  const before = idle();
  panel.handleInput('\x02'); // control characters are never inserted
  assert.deepEqual(idle(), before);
  panel.handleInput('abc'); // chunk pasted at the end of the prefilled host
  assert.match(caretRow(panel, 60), /192\.168\.1\.20abc▏/);
  panel.handleInput('\x1b[D'); // caret before the pasted tail
  panel.handleInput('XY'); // multi-character insert in the middle
  assert.match(caretRow(panel, 60), /192\.168\.1\.20abXY▏c/);
  panel.handleInput('\r');
  assert.deepEqual(submitted, [{ host: '192.168.1.20abXYc', port: '34316', publicOrigin: '' }]);
});

test('invalid values keep the form open and show the error inside the frame', () => {
  const message = 'Port must be an integer from 1 to 65535.';
  const { panel, submitted, theme } = fixture({ validate: () => message });
  panel.handleInput('\t');
  panel.handleInput('\r');
  assert.equal(submitted.length, 0);
  const plain = plainRows(panel, 60);
  const errorRow = plain.find(row => row.includes(message));
  assert.ok(errorRow, 'error message is rendered');
  assert.match(errorRow, /^│/);
  assert.match(errorRow, /│$/);
  assert.match(errorRow, /⚠ /);
  assert.ok(theme.paints.some(([role, text]) => role === 'error' && text.includes(message)));
  // Still editable after a rejected submit; the next edit clears the error.
  panel.handleInput('3');
  const plainAfter = plainRows(panel, 60);
  assert.match(caretRow(panel, 60), /343163▏/);
  assert.equal(plainAfter.join('\n').includes(message), false);
  assert.equal(plainAfter.some(row => row.includes('⚠ ')), false);
  // The form is still open, so a later enter is rejected again.
  panel.handleInput('\r');
  assert.equal(submitted.length, 0);
});

test('validate that throws is reported in the frame instead of closing', () => {
  const { panel, submitted, theme } = fixture({ validate: () => { throw new TypeError('Host is required.'); } });
  panel.handleInput('\r');
  assert.equal(submitted.length, 0);
  assert.match(plainRows(panel, 60).join('\n'), /⚠ Host is required\./);
  assert.ok(theme.paints.some(([role, text]) => role === 'error' && text.includes('Host is required.')));
});

test('escape and ctrl-c cancel without submitting', () => {
  for (const data of ['\x1b', '\x03']) {
    const { panel, submitted, cancelled } = fixture();
    panel.handleInput('x');
    panel.handleInput(data);
    assert.equal(cancelled.length, 1);
    assert.equal(submitted.length, 0);
    panel.handleInput('y');
    panel.handleInput('\r');
    assert.equal(cancelled.length, 1);
    assert.equal(submitted.length, 0);
  }
});

test('narrow terminals get a frameless fallback that still shows every field', () => {
  const { panel } = fixture();
  const rows = panel.render(24);
  const plain = rows.map(unstyle);
  assert.equal(plain.some(row => /[│╭╮╰╯]/u.test(row)), false);
  assert.ok(rows.every(row => visibleWidth(row) <= 24));
  assert.match(plain[0], /Canvas LAN setup/);
  assert.ok(plain.some(row => /Host \/ IP to bind:/.test(row)));
  assert.ok(plain.some(row => /Port: 34316/.test(row)));
  assert.ok(plain.some(row => /esc/.test(row)));
  // The fallback applies below 30 columns; the frame starts exactly at 30.
  assert.equal(plainRows(panel, 29).some(row => /[│╭╮╰╯]/u.test(row)), false);
  assert.match(plainRows(panel, 30)[0], /^╭─ ▤ Canvas LAN setup/);
  assert.deepEqual(panel.render(0), []);
});

test('empty optional field shows its dim placeholder when unfocused', () => {
  const { panel, theme } = fixture();
  const plain = plainRows(panel, 60);
  assert.ok(theme.paints.some(([role, text]) => role === 'dim' && text === 'https://canvas.example'));
  assert.ok(plain.some(row => row.includes('https://canvas.example')));
});

test('focused empty field shows the caret instead of its placeholder', () => {
  const { panel, theme } = fixture();
  panel.handleInput('\t');
  panel.handleInput('\t'); // focus the empty public origin
  const plain = plainRows(panel, 60);
  assert.equal(theme.paints.some(([role, text]) => role === 'dim' && text === 'https://canvas.example'), false);
  assert.ok(theme.paints.some(([role, text]) => role === 'accent' && text === '▏'));
  assert.equal(plain.some(row => row.includes('https://canvas.example')), false);
});

test('invalidate is a no-op and rendering is repeatable', () => {
  const { panel } = fixture();
  const rows = panel.render(60);
  assert.deepEqual(panel.render(60), rows);
  assert.deepEqual(panel.render(24), panel.render(24));
  panel.invalidate();
  assert.deepEqual(panel.render(60), rows);
});

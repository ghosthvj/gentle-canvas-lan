import test from 'node:test';
import assert from 'node:assert/strict';
import { createLanPanel } from '../src/lan-panel.js';

// Deliberately model wide characters and styled output without a runtime dependency.
const unstyle = text => text.replace(/\x1b\]8;;[^\x1b\x07]*(?:\x1b\\|\x07)/g, '').replace(/\x1b\[[0-9;]*m/g, '');
const targets = text => [...text.matchAll(/\x1b\]8;;([^\x1b\x07]+)(?:\x1b\\|\x07)/g)].map(match => match[1]);
const visibleWidth = text => [...unstyle(text)].reduce((width, char) =>
  width + (/[▾▸▤]/u.test(char) ? 1 : /[^\x00-\x7f]/u.test(char) ? 2 : 1), 0);
const truncateToWidth = (text, width, ellipsis = '…') => {
  if (visibleWidth(text) <= width) return text;
  let result = '';
  for (const char of text) {
    if (visibleWidth(result + char + ellipsis) > width) break;
    result += char;
  }
  return result + ellipsis;
};

function fixture() {
  const paints = [];
  const theme = {
    color: 36,
    fg(role, text) {
      assert.ok(['accent', 'text', 'dim'].includes(role));
      paints.push([role, this.color]);
      return `\x1b[${this.color}m${text}\x1b[0m`;
    },
    bold: text => `\x1b[1m${text}\x1b[0m`,
    underline: text => `\x1b[4m${text}\x1b[0m`,
  };
  return { panel: createLanPanel({ theme, truncateToWidth, visibleWidth }), theme, paints };
}

const urls = [
  'http://192.168.1.20:34316/Abcd_0123456789-x/',
  `http://[2001:db8::1234]:34316/${'aB_9-'.repeat(100)}/?file=a%2Fb&name=c+e#view`,
  'https://例え.test/画面/😀?name=広い#位置',
];

for (const width of [180, 48, 40, 20, 1]) {
  for (const [index, url] of urls.entries()) {
    test(`width ${width}: full hyperlink destination ${index}, compact label and no frame`, () => {
      const { panel } = fixture();
      panel.setUrl(url);
      const rows = panel.render(width);
      const plain = rows.map(unstyle);
      assert.equal(plain[0], truncateToWidth('▾ CANVAS LAN', width, ''));
      const label = truncateToWidth('Open Design Canvas', width, '');
      if (label) {
        assert.deepEqual(targets(rows[1]), [new URL(url).href]);
        assert.equal(plain[1], label);
        assert.equal(plain.slice(2).join(''), new URL(url).href);
      } else {
        assert.equal(plain.slice(1).join(''), new URL(url).href);
      }
      assert.ok(rows.every(row => visibleWidth(row) <= width));
      assert.ok(plain.every(row => row.length > 0 && !/[\x00-\x1f\x7f-\x9f]/u.test(row)));
      assert.ok(!plain.join('\n').includes('Local'));
      assert.ok(!/[│┌┐└┘]/u.test(plain.join('')));
      assert.deepEqual(panel.render(width), rows);
    });
  }
}

test('header press claims and click toggles; link and unrelated mouse events remain untouched', () => {
  const { panel } = fixture();
  panel.setUrl(urls[0]);
  const before = panel.digest();
  const event = { x: 0, y: 0, width: 40, height: 2, button: 'left' };
  assert.deepEqual(panel.handleMouse({ ...event, type: 'press' }), { handled: true });
  assert.equal(panel.digest(), before);
  assert.deepEqual(panel.handleMouse({ ...event, type: 'click' }), { handled: true, render: true });
  assert.notEqual(panel.digest(), before);
  assert.equal(panel.render(40).length, 1);
  assert.match(unstyle(panel.render(40)[0]), /^▸ CANVAS LAN/);
  assert.equal(panel.handleMouse({ ...event, type: 'click', y: 1 }), undefined);
  assert.equal(panel.handleMouse({ ...event, type: 'click', button: 'right' }), undefined);
  assert.deepEqual(panel.handleMouse({ ...event, type: 'click', height: 1 }), { handled: true, render: true });
  assert.ok(panel.render(40).length > 2);
  assert.deepEqual(targets(panel.render(40)[1]), [urls[0]]);
  assert.equal(unstyle(panel.render(40).slice(2).join('')), urls[0]);
});

test('decorated card keeps dash and glyph outside the underlined link', () => {
  const theme = { fg: (_role, text) => text, bold: text => text, underline: text => text };
  const panel = createLanPanel({ theme, truncateToWidth, visibleWidth, decorated: true });
  panel.setUrl(urls[0]);
  for (const width of [48, 40]) {
    const rows = panel.render(width);
    const plain = rows.map(unstyle);
    assert.equal(plain[1], truncateToWidth('- ▤ Open Design Canvas', width, ''));
    const linkStart = rows[1].indexOf('\x1b]8;;');
    const labelStart = plain[1].indexOf('Open Design Canvas');
    assert.ok(linkStart >= 0 && labelStart >= 0);
    assert.equal(visibleWidth(plain[1].slice(0, labelStart)), visibleWidth('- ▤ '));
    assert.doesNotMatch(rows[1].slice(0, linkStart), /Open Design Canvas/);
    assert.deepEqual(targets(rows[1]), [urls[0]]);
  }
});

test('visible URL text is never underlined and stays complete for Ctrl+click', () => {
  const theme = { fg: (_role, text) => text, bold: text => text, underline: text => `\x1b[4m${text}\x1b[0m` };
  const panel = createLanPanel({ theme, truncateToWidth, visibleWidth, decorated: true });
  panel.setUrl(urls[1]);
  for (const width of [48, 20]) {
    const rows = panel.render(width);
    const plain = rows.map(unstyle);
    assert.equal(plain.join('').includes('\x1b[4m'), false);
    assert.equal(plain.slice(2).join(''), new URL(urls[1]).href);
    assert.ok(rows.every(row => visibleWidth(row) <= width));
  }
});

test('optional OSC 8 probe puts the plain URL first and the action label second', () => {
  const theme = { fg: (_role, text) => text, bold: text => text, underline: text => text };
  const probe = createLanPanel({ theme, truncateToWidth, visibleWidth, decorated: true, osc8Probe: true });
  const plainOnly = createLanPanel({ theme, truncateToWidth, visibleWidth, decorated: true });
  const short = 'http://10.10.5.34:34316/s/96ca25cf56b6c895';
  probe.setUrl(short);
  plainOnly.setUrl(short);
  const rendered = probe.render(48);
  const rows = rendered.map(unstyle);
  const plainRows = plainOnly.render(48).map(unstyle);
  assert.equal(rows.filter(row => row === short).length, 1);
  assert.equal(plainRows.filter(row => row === short).length, 1);
  assert.equal(rows.at(-1), '- ▤ Open Design Canvas');
  assert.deepEqual(targets(rendered.at(-1)), [short]);
  assert.ok(rendered.findIndex(row => unstyle(row) === short) < rendered.length - 1, 'plain URL precedes the OSC 8 label');
});

test('idle, replacement, clearing and invalidation preserve public state semantics', () => {
  const { panel } = fixture();
  const empty = panel.digest();
  assert.deepEqual(panel.render(40), []);
  panel.invalidate();
  assert.equal(panel.digest(), empty);
  panel.setUrl(urls[0]);
  const active = panel.digest();
  assert.notEqual(active, empty);
  assert.ok(active.includes(new URL(urls[0]).href));
  panel.invalidate();
  assert.equal(panel.digest(), active);
  panel.setUrl(urls[1]);
  assert.notEqual(panel.digest(), active);
  assert.deepEqual(targets(panel.render(40)[1]), [urls[1]]);
  panel.setUrl(null);
  assert.equal(panel.digest(), empty);
  assert.deepEqual(panel.render(1), []);
});

test('canonical URL identity and changed theme paint are not cached', () => {
  const { panel, theme, paints } = fixture();
  panel.setUrl(urls[2]);
  const canonical = new URL(urls[2]).href;
  const digest = panel.digest();
  const before = panel.render(48);
  theme.color = 35;
  const after = panel.render(48);
  assert.notDeepEqual(after, before);
  assert.deepEqual(after.map(unstyle), before.map(unstyle));
  assert.ok(paints.some(([, color]) => color === 35));
  panel.setUrl(canonical);
  assert.equal(panel.digest(), digest);
  panel.invalidate();
  assert.deepEqual(panel.render(48), after);
});

test('raw controls and invalid URLs are rejected without changing the last usable card', () => {
  const { panel } = fixture();
  panel.setUrl(urls[0]);
  const before = panel.render(40);
  const digest = panel.digest();
  const invalid = [undefined, 42, '', 'not a URL', 'file:///tmp/canvas',
    'javascript:alert(1)', 'https://user:password@example.test/path'];
  for (const control of ['\x00', '\n', '\r', '\t', '\x1b', '\x7f', '\x85', '\x9b']) {
    invalid.push(`http://192.168.1.20/to${control}ken/`);
  }
  for (const value of invalid) {
    assert.throws(() => panel.setUrl(value), {
      name: 'TypeError', message: 'Expected a control-free HTTP(S) LAN URL or null.',
    });
    assert.equal(panel.digest(), digest);
    assert.deepEqual(panel.render(40), before);
  }
});

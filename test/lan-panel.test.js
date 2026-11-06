import test from 'node:test';
import assert from 'node:assert/strict';
import { createLanPanel } from '../src/lan-panel.js';

// Deliberately model wide characters and styled output without a runtime dependency.
const unstyle = text => text.replace(/\x1b\[[0-9;]*m/g, '');
const visibleWidth = text => [...unstyle(text)].reduce((width, char) =>
  width + (/[^\x00-\x7f]/u.test(char) ? 2 : 1), 0);
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
    test(`width ${width}: complete canonical URL ${index}, compact header and no frame`, () => {
      const { panel } = fixture();
      panel.setUrl(url);
      const rows = panel.render(width);
      const plain = rows.map(unstyle);
      assert.equal(plain[0], truncateToWidth('CANVAS LAN', width, ''));
      assert.equal(plain.slice(1).join(''), new URL(url).href);
      assert.ok(rows.every(row => visibleWidth(row) <= width));
      assert.ok(plain.every(row => row.length > 0 && !/[\x00-\x1f\x7f-\x9f]/u.test(row)));
      assert.ok(!plain.join('\n').includes('Local'));
      assert.ok(!/[│┌┐└┘]/u.test(plain.join('')));
      assert.deepEqual(panel.render(width), rows);
    });
  }
}

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
  assert.equal(panel.render(40).slice(1).map(unstyle).join(''), urls[1]);
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

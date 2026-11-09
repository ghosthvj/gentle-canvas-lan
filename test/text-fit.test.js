import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateToWidth, visibleWidth } from '../src/text-fit.js';

const SGR = /\x1b\[[0-9;]*m/g;
const plain = text => text.replace(SGR, '');

test('measures single-cell text, wide ranges and combining marks', () => {
  for (const [text, width] of [
    ['', 0],
    ['canvas', 6],
    ['ñandú', 5],
    ['e\u0301', 1], // combining acute does not advance
    ['日', 2],
    ['ｆｕｌｌ', 8],
    ['▤', 1], // ambiguous-width box drawing stays single-cell
    ['▸', 1],
    ['▏', 1],
    ['…', 1],
    ['\x1b[31mred\x1b[0m', 3],
    ['\x1b]8;;http://x\x07link\x1b]8;;\x07', 4],
  ]) assert.equal(visibleWidth(text), width, JSON.stringify(text));
});

test('a text-presentation pictograph is one cell, emoji presentation is two', () => {
  // ⚠ defaults to text presentation; counting it as two shortened a frame row
  // and pushed the right border out of alignment.
  assert.equal(visibleWidth('⚠'), 1);
  assert.equal(visibleWidth('⚠ error'), 7);
  assert.equal(visibleWidth('⚠\ufe0f'), 2); // VS16 promotes it
  assert.equal(visibleWidth('🦄'), 2); // Emoji_Presentation
});

test('clips to the column budget and keeps styles balanced', () => {
  assert.equal(plain(truncateToWidth('abcdef', 4)), 'abc…');
  assert.equal(visibleWidth(truncateToWidth('\x1b[31mabcdef\x1b[0m', 4)), 4);
  assert.ok(truncateToWidth('\x1b[31mabcdef\x1b[0m', 4).endsWith('\x1b[0m'));
  assert.equal(truncateToWidth('abcdef', 10), 'abcdef');
  // Pre-existing behaviour: a zero budget still leaves the ellipsis, while a
  // negative or non-finite budget yields nothing at all.
  assert.equal(plain(truncateToWidth('abcdef', 0)), '…');
  assert.equal(truncateToWidth('abcdef', -1), '');
  assert.equal(truncateToWidth('abcdef', Number.NaN), '');
  // A wide character that no longer fits is dropped, never split.
  assert.equal(plain(truncateToWidth('日日', 3)), '日…');
  assert.equal(visibleWidth(truncateToWidth('日日', 3)), 3);
  assert.equal(plain(truncateToWidth('abcdef', 4, '...')), 'a...');
});

test('flags are one glyph and skin-tone modifiers add no width', () => {
  assert.equal(visibleWidth('🇦'), 1);
  assert.equal(visibleWidth('🇦🇨'), 2); // pair, not two glyphs of two cells
  assert.equal(visibleWidth('👍🏽'), 2); // tone modifier attaches to its base
  assert.equal(visibleWidth('🏽'), 0);
  assert.equal(plain(truncateToWidth('🇦🇨🇦🇨', 3)), '🇦🇨…');
  assert.equal(visibleWidth(truncateToWidth('🇦🇨🇦🇨', 3)), 3);
});

test('escape tokens, combining sequences and wide ranges stay zero/one/two cells', () => {
  assert.equal(visibleWidth('\x1b[m'), 0);
  assert.equal(visibleWidth('\x1b[?25l'), 0);
  assert.equal(visibleWidth('\x1b]0;title\x07'), 0);
  assert.equal(visibleWidth('e\u0301\u0302\u0303'), 1);
  assert.equal(visibleWidth('\x1b]8;;u\x1b\\x\x1b]8;;\x1b\\'), 1); // ST-terminated OSC 8
  assert.equal(visibleWidth('Ａ'), 2);
  assert.equal(visibleWidth('한'), 2);
  assert.equal(visibleWidth('╰'), 1);
  assert.equal(visibleWidth('☂\ufe0f'), 2); // VS16 promotes a text-presentation glyph
  // Baseline behaviour kept: a cut closes styling opened anywhere in the source.
  assert.equal(truncateToWidth('abcdefgh\x1b[31mred\x1b[0m', 4), 'abc…\x1b[0m');
});

test('truncateToWidth never exceeds budget and never splits escapes or wide chars', () => {
  const atoms = ['a', '日', '⚠', '🦄', '▤', '🇦', '🇨', '🏽', '\x1b[31m', '\x1b[0m', '\x1b]8;;u\x07', '\x1b]8;;\x07'];
  const ESC = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 500; i++) {
    let text = '';
    for (let k = 0, n = 1 + Math.floor(rnd() * 8); k < n; k++) text += atoms[Math.floor(rnd() * atoms.length)];
    // A zero budget is the pinned pre-existing quirk below, so probe from one.
    const budget = 1 + Math.floor(rnd() * 11);
    const out = truncateToWidth(text, budget);
    assert.ok(visibleWidth(out) <= budget, `${JSON.stringify(text)} @${budget} -> ${JSON.stringify(out)}`);
    for (let j = 0; j < out.length; j++) {
      if (out.charCodeAt(j) !== 0x1b) continue;
      ESC.lastIndex = j;
      const match = ESC.exec(out);
      assert.ok(match && match.index === j, `no split escape in ${JSON.stringify(out)}`);
    }
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(out), 'no split surrogate');
    const body = out.replace(ESC, '').replace(/…$/, '');
    assert.ok(text.replace(ESC, '').startsWith(body), 'printable prefix preserved');
  }
  assert.equal(truncateToWidth('\x1b[1m日本語\x1b[0m', 2, ''), '\x1b[1m日\x1b[0m');
});

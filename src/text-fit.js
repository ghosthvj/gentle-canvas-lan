// Terminal text measurement without a runtime dependency: the host may expose
// only a partial TUI module, so panels measure and clip their own output.
const ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const COMBINING = /^[\p{Mn}\p{Me}\u200b-\u200f\ufe00-\ufe0f]$/u;
// East Asian wide/fullwidth ranges: always two cells.
const WIDE = /^[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]$/u;
// Emoji that default to emoji presentation render two cells; other pictographs
// (⚠, ✔, ☂...) default to text presentation and render one unless VS16 follows.
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u;
const PICTOGRAPH = /^\p{Extended_Pictographic}$/u;
// Regional indicators and skin-tone modifiers are Emoji_Presentation too, but a
// flag pair is one two-cell glyph and a modifier adds nothing to its base.
const REGIONAL = /^[\u{1F1E6}-\u{1F1FF}]$/u;
const TONE = /^[\u{1F3FB}-\u{1F3FF}]$/u;
const VS16 = '\ufe0f';

const cellWidth = (char, next) => {
  if (COMBINING.test(char)) return 0;
  if (EMOJI_PRESENTATION.test(char)) return 2;
  if (PICTOGRAPH.test(char)) return next === VS16 ? 2 : 1;
  return WIDE.test(char) ? 2 : 1;
};

/** Width of one rendered atom, before the regional-indicator pair rule. */
const atomWidth = (char, next) => {
  if (COMBINING.test(char) || TONE.test(char)) return 0;
  if (REGIONAL.test(char)) return 1;
  return cellWidth(char, next);
};

/** Split into escape tokens and single code points, preserving source order. */
const tokenize = text => {
  const tokens = [];
  const source = String(text);
  for (let index = 0; index < source.length;) {
    ESCAPE.lastIndex = index;
    const escape = ESCAPE.exec(source);
    if (escape && escape.index === index) {
      tokens.push(escape[0]);
      index += escape[0].length;
      continue;
    }
    const char = String.fromCodePoint(source.codePointAt(index));
    tokens.push(char);
    index += char.length;
  }
  return tokens;
};

const isEscapeToken = token => token.length > 1 && token.charCodeAt(0) === 0x1b;

/** Printable width of a possibly styled string. */
export function visibleWidth(text) {
  const tokens = tokenize(text);
  let width = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (isEscapeToken(token)) continue;
    const paired = REGIONAL.test(token) && REGIONAL.test(tokens[index + 1] ?? '');
    if (paired) {
      width += 2; // one flag glyph
      index++;
      continue;
    }
    width += atomWidth(token, tokens[index + 1]);
  }
  return width;
}

/** Clip a possibly styled string to a column budget, keeping escapes intact. */
export function truncateToWidth(text, width, ellipsis = '…') {
  const tokens = tokenize(text);
  const budget = Math.floor(width);
  if (!Number.isFinite(budget) || budget < 0) return '';
  if (visibleWidth(text) <= budget) return text;
  const ellipsisWidth = visibleWidth(ellipsis);
  let result = '';
  let used = 0;
  let cut = false;
  // Baseline behaviour: a cut always closes an opened SGR run, wherever it was.
  const styled = /\x1b\[[0-9;]*m/.test(text);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (isEscapeToken(token)) {
      result += token;
      continue;
    }
    const paired = REGIONAL.test(token) && REGIONAL.test(tokens[index + 1] ?? '');
    const charWidth = paired ? 2 : atomWidth(token, tokens[index + 1]);
    if (used + charWidth + ellipsisWidth > budget) { cut = true; break; }
    result += token;
    if (paired) {
      result += tokens[index + 1];
      index++;
    }
    used += charWidth;
  }
  if (!cut) return result;
  return `${result}${ellipsis}${styled ? '\x1b[0m' : ''}`;
}

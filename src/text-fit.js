// Terminal text measurement without a runtime dependency: the host may expose
// only a partial TUI module, so panels measure and clip their own output.
const ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const COMBINING = /^[\p{Mn}\p{Me}\u200b-\u200f\ufe00-\ufe0f]$/u;
const WIDE = /^[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|^\p{Extended_Pictographic}$/u;

/** Printable width of a possibly styled string. */
export function visibleWidth(text) {
  let width = 0;
  for (const char of String(text).replace(ESCAPE, '')) {
    if (COMBINING.test(char)) continue;
    width += WIDE.test(char) ? 2 : 1;
  }
  return width;
}

/** Clip a possibly styled string to a column budget, keeping escapes intact. */
export function truncateToWidth(text, width, ellipsis = '…') {
  const source = String(text);
  const budget = Math.floor(width);
  if (!Number.isFinite(budget) || budget < 0) return '';
  if (visibleWidth(source) <= budget) return source;
  const ellipsisWidth = visibleWidth(ellipsis);
  let result = '';
  let used = 0;
  let cut = false;
  for (let index = 0; index < source.length;) {
    ESCAPE.lastIndex = index;
    const escape = ESCAPE.exec(source);
    if (escape && escape.index === index) {
      result += escape[0];
      index += escape[0].length;
      continue;
    }
    const char = String.fromCodePoint(source.codePointAt(index));
    const charWidth = COMBINING.test(char) ? 0 : WIDE.test(char) ? 2 : 1;
    if (used + charWidth + ellipsisWidth > budget) { cut = true; break; }
    result += char;
    used += charWidth;
    index += char.length;
  }
  if (!cut) return result;
  return `${result}${ellipsis}${/\x1b\[[0-9;]*m/.test(source) ? '\x1b[0m' : ''}`;
}

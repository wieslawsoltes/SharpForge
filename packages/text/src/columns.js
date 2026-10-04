import { iterateGraphemes } from './graphemes.js';

function wide(code) {
  return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a
    || code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f
    || code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff
    || code >= 0xfe10 && code <= 0xfe19 || code >= 0xfe30 && code <= 0xfe6f
    || code >= 0xff01 && code <= 0xff60 || code >= 0xffe0 && code <= 0xffe6
    || code >= 0x1b000 && code <= 0x1b2ff || code >= 0x20000 && code <= 0x3fffd);
}

function validateTabSize(tabSize) {
  if (!Number.isInteger(tabSize) || tabSize < 1 || tabSize > 256) throw new RangeError('Tab size must be between 1 and 256');
}

/** Internal packed point metrics: low bits are visible base width, bit 2 requests emoji presentation for a nonempty cluster. */
export function codePointColumnMetrics(code, ambiguousWidth = 1) {
  if (code >= 32 && code <= 126) return ambiguousWidth;
  if (code === 0xfe0f || code === 0x20e3) return 4;
  const character = String.fromCodePoint(code);
  if (/[\p{M}\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(character)) return 0;
  if (/\p{Emoji_Presentation}|\p{Regional_Indicator}/u.test(character)) return 6;
  return wide(code) ? 2 : ambiguousWidth;
}

/** Monospace visual width of one extended cluster; tabs use the incoming zero-based visual column. */
export function graphemeWidth(segment, column = 0, { tabSize = 4, ambiguousWidth = 1 } = {}) {
  validateTabSize(tabSize);
  if (segment === '\t') return tabSize - column % tabSize;
  let width = 0;
  let emoji = false;
  for (const character of segment) {
    const metrics = codePointColumnMetrics(character.codePointAt(0), ambiguousWidth);
    width = Math.max(width, metrics & 3);
    emoji ||= !!(metrics & 4);
  }
  return width && emoji ? 2 : width;
}

/** Map UTF-16 character positions to visual columns without splitting a cluster. */
export function visualColumnAt(text, offset = text.length, options = {}) {
  let column = 0;
  for (const item of iterateGraphemes(text, options)) {
    if (item.end > offset) break;
    column += graphemeWidth(item.segment, column, options);
  }
  return column;
}

/** Map visual columns back to logical positions, preserving virtual space beyond a short line. */
export function offsetAtVisualColumn(text, target, options = {}) {
  if (!Number.isFinite(target) || target < 0) throw new RangeError('Visual column must be non-negative');
  const bias = options.bias ?? 'left';
  let column = 0;
  for (const item of iterateGraphemes(text, options)) {
    const width = graphemeWidth(item.segment, column, options);
    if (column + width > target) {
      const right = bias === 'right' || bias === 'nearest' && target - column >= width / 2;
      return {
        offset: right ? item.end : item.index, column: right ? column + width : column, virtualSpaces: 0,
        insideTab: item.segment === '\t', intraColumn: target - column,
        graphemeStart: item.index, graphemeEnd: item.end, width
      };
    }
    column += width;
    if (column === target) return { offset: item.end, column, virtualSpaces: 0, insideTab: false };
  }
  return { offset: text.length, column, virtualSpaces: Math.max(0, Math.trunc(target - column)), insideTab: false };
}

/** Expand tabs using the same column model as caret placement and rectangular editing. */
export function expandTabs(text, options = {}) {
  let column = 0;
  const output = [];
  for (const item of iterateGraphemes(text, options)) {
    const width = graphemeWidth(item.segment, column, options);
    output.push(item.segment === '\t' ? ' '.repeat(width) : item.segment);
    column += width;
  }
  return output.join('');
}

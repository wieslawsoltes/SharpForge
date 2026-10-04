import {keywords} from '@sharpforge/syntax';
import {isHighlightBracket} from './highlight-brackets.js';

function tokenKind(token, index, tokens) {
  if (['string', 'char', 'interpolated'].includes(token.kind)) return 'string';
  if (['integer', 'double'].includes(token.kind)) return 'number';
  if (keywords.has(token.kind)) return 'keyword';
  if (token.kind !== 'identifier') return 'punctuation';
  const first = token.text[0];
  if (index > 0 && tokens.raw(index - 1).kind === 'class' ||
      first === first?.toUpperCase() && first !== first?.toLowerCase()) return 'type';
  return index + 1 < tokens.length && tokens.raw(index + 1).kind === '(' ? 'method' : 'identifier';
}

/** Build only the requested runs; green trivia keeps comments crossing the window source-faithful. */
export function highlightRuns(tokens, start, end, brackets, maximum = Infinity) {
  const plain = () => ({runs: end > start ? [{start, end, kind: '', bracket: false}] : [], syntax: false});
  if (!tokens) return plain();
  const runs = [];
  const push = (from, to, kind = '', bracket = false) => {
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (b > a) runs.push({start: a, end: b, kind, bracket});
  };
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (tokens.endAt(middle) <= start) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < tokens.length; index++) {
    const token = tokens.get(index);
    if (token.fullStart >= end) break;
    let at = token.fullStart;
    for (const match of token.green.leading.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g)) {
      const begin = token.fullStart + match.index;
      push(at, begin);
      push(begin, begin + match[0].length, 'comment');
      at = begin + match[0].length;
      if (runs.length > maximum) return plain();
    }
    push(at, token.start);
    push(token.start, token.end, tokenKind(token, index, tokens), isHighlightBracket(token.kind) && brackets.has(token.start));
    if (runs.length > maximum) return plain();
  }
  return {runs, syntax: true};
}

export function highlightRange(source, {scrollTop = 0, height = 400, lineHeight = 22, padding = 14, overscan = 4, maxRuns = 10000} = {}) {
  if (![scrollTop, height, lineHeight, padding, overscan, maxRuns].every(Number.isFinite) ||
      scrollTop < 0 || height < 0 || lineHeight <= 0 || overscan < 0 || overscan > 100 || !Number.isInteger(maxRuns) || maxRuns < 1) {
    throw new RangeError('Invalid highlight viewport');
  }
  const starts = source.lineStarts;
  const firstLine = Math.min(starts.length - 1, Math.max(0, Math.floor((scrollTop - padding) / lineHeight) - Math.floor(overscan)));
  const lastLine = Math.min(starts.length, firstLine + Math.min(2000, Math.ceil(height / lineHeight) + Math.ceil(overscan) * 2 + 2));
  const start = starts[firstLine];
  const end = starts[lastLine] ?? source.length;
  return {firstLine, lastLine, start, end, characters: end - start, maxRuns};
}

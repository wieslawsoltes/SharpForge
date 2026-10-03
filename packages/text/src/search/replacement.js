import { findTextMatches } from './find.js';

/** Expand ECMAScript-style replacement tokens; literal search callers should leave replacement text unexpanded. */
export function expandReplacement(replacement, match, sourceText, { maxLength = 16000000 } = {}) {
  if (typeof replacement !== 'string') throw new TypeError('Replacement must be a string');
  const pieces = [];
  let length = 0;
  const append = value => {
    value ??= '';
    length += value.length;
    if (length > maxLength) throw new RangeError('Expanded replacement exceeds output limit');
    pieces.push(value);
  };
  let literalStart = 0;
  for (let index = 0; index < replacement.length; index++) {
    if (replacement[index] !== '$' || index + 1 === replacement.length) continue;
    const marker = replacement[index + 1];
    let value;
    let consumed = 2;
    if (marker === '$') value = '$';
    else if (marker === '&') value = match.text ?? sourceText?.slice(match.start, match.end) ?? '';
    else if (marker === '`' || marker === "'") {
      if (typeof sourceText !== 'string') throw new TypeError('Prefix/suffix replacement requires source text');
      value = marker === '`' ? sourceText.slice(0, match.start) : sourceText.slice(match.end);
    } else if (marker === '<' && match.groups !== undefined) {
      const end = replacement.indexOf('>', index + 2);
      if (end < 0) continue;
      value = match.groups[replacement.slice(index + 2, end)] ?? '';
      consumed = end - index + 1;
    } else if (/[1-9]/.test(marker)) {
      let group = Number(marker);
      const next = replacement[index + 2];
      if (/[0-9]/.test(next ?? '') && group * 10 + Number(next) <= (match.captures?.length ?? 0)) {
        group = group * 10 + Number(next);
        consumed = 3;
      }
      if (group > (match.captures?.length ?? 0)) continue;
      value = match.captures[group - 1] ?? '';
    } else continue;
    append(replacement.slice(literalStart, index));
    append(value);
    index += consumed - 1;
    literalStart = index + 1;
  }
  append(replacement.slice(literalStart));
  return pieces.join('');
}

/** Preflight every replacement and total output size before constructing a changed document. */
export function replaceTextMatches(text, query, replacement, options = {}) {
  const result = findTextMatches([{ uri: options.uri ?? 'buffer', text, version: options.version }], query, {
    ...options, maxMatches: options.maxMatches ?? 10000
  });
  if (result.truncated) throw new RangeError('More than 10000 replacements; narrow the search');
  const maxLength = options.maxLength ?? 16000000;
  let outputLength = text.length;
  const edits = result.matches.map(match => {
    const expanded = options.regex ? expandReplacement(replacement, match, text, { maxLength }) : replacement;
    if (typeof expanded !== 'string') throw new TypeError('Replacement must be a string');
    outputLength += expanded.length - (match.end - match.start);
    if (outputLength > maxLength) throw new RangeError('Replacement result exceeds output limit');
    return { start: match.start, end: match.end, text: expanded };
  });
  const pieces = [];
  let previous = 0;
  for (const edit of edits) { pieces.push(text.slice(previous, edit.start), edit.text); previous = edit.end; }
  pieces.push(text.slice(previous));
  return { text: pieces.join(''), count: edits.length, matches: result.matches, edits };
}

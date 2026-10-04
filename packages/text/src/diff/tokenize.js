import { DiffLimit } from './budget.js';

function normalized(value, whitespace) {
  if (whitespace === true || whitespace === 'all') return value.replace(/\s+/gu, '');
  if (whitespace === 'trim') return value.trim();
  return value;
}

/** Token boundaries retain exact original offsets, including CRLF and supplementary Unicode scalars. */
export function tokenize(text, kind, options, budget) {
  const values = [];
  const offsets = [0];
  const limit = options.maxTokens ?? 200000;
  const append = (start, end) => {
    if (values.length >= limit) throw new DiffLimit('token count');
    values.push(normalized(text.slice(start, end), options.ignoreWhitespace));
    offsets.push(end);
  };
  if (kind === 'character') {
    for (let offset = 0; offset < text.length;) {
      budget.tick();
      const length = String.fromCodePoint(text.codePointAt(offset)).length;
      append(offset, offset + length);
      offset += length;
    }
    return { values, offsets };
  }
  let start = 0;
  let previous = '';
  for (let offset = 0; offset < text.length;) {
    budget.tick();
    const character = String.fromCodePoint(text.codePointAt(offset));
    if (kind === 'line') {
      if (character === '\r' || character === '\n') {
        const end = offset + (character === '\r' && text[offset + 1] === '\n' ? 2 : 1);
        append(start, end);
        start = end;
        offset = end;
        continue;
      }
    } else {
      const current = /[\p{L}\p{N}\p{M}_]/u.test(character) ? 'word' : /\s/u.test(character) ? 'space' : 'punctuation';
      if (offset > start && (current !== previous || current === 'punctuation')) { append(start, offset); start = offset; }
      previous = current;
    }
    offset += character.length;
  }
  if (start < text.length) append(start, text.length);
  return { values, offsets };
}

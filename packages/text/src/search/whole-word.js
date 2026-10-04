const WORD = /[\p{L}\p{N}\p{M}_]/u;

/** Word boundaries inspect whole Unicode scalars on both sides of a UTF-16 match. */
export function wholeWord(text, match) {
  let start = match.start - 1;
  if (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) start--;
  const previous = text.slice(Math.max(0, start), match.start);
  const next = match.end < text.length ? String.fromCodePoint(text.codePointAt(match.end)) : '';
  return !WORD.test(previous) && !WORD.test(next);
}

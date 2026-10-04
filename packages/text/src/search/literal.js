import { foldCharacter } from './predicates.js';

/** Linear KMP literal search with UTF-16 spans; Unicode folding never changes the recorded offsets. */
export function* literalMatches(text, query, options, budget) {
  const needle = Array.from(query, character => options.matchCase ? character : foldCharacter(character));
  const failure = new Uint32Array(needle.length);
  for (let index = 1, prefix = 0; index < needle.length; index++) {
    while (prefix > 0 && needle[index] !== needle[prefix]) prefix = failure[prefix - 1];
    if (needle[index] === needle[prefix]) prefix++;
    failure[index] = prefix;
  }
  const positions = new Uint32Array(needle.length);
  let ordinal = 0;
  let prefix = 0;
  for (let offset = 0; offset < text.length;) {
    budget.tick();
    const character = String.fromCodePoint(text.codePointAt(offset));
    const folded = options.matchCase ? character : foldCharacter(character);
    positions[ordinal % needle.length] = offset;
    while (prefix > 0 && folded !== needle[prefix]) { budget.tick(); prefix = failure[prefix - 1]; }
    if (folded === needle[prefix]) prefix++;
    const end = offset + character.length;
    if (prefix === needle.length) {
      yield { start: positions[(ordinal - needle.length + 1) % needle.length], end, captures: null };
      prefix = 0;
    }
    ordinal++;
    offset = end;
  }
}

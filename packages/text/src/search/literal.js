import { foldCharacter } from './predicates.js';

/** One scalar KMP state survives chunk boundaries; reverse traversal uses the reversed pattern. */
export class LiteralMatcher {
  constructor(query, options, budget, {direction = 1, overlapping = false} = {}) {
    this.needle = Array.from(query, character => options.matchCase ? character : foldCharacter(character));
    if (direction < 0) this.needle.reverse();
    this.failure = new Uint32Array(this.needle.length);
    for (let index = 1, prefix = 0; index < this.needle.length; index++) {
      while (prefix > 0 && this.needle[index] !== this.needle[prefix]) prefix = this.failure[prefix - 1];
      if (this.needle[index] === this.needle[prefix]) prefix++;
      this.failure[index] = prefix;
    }
    this.positions = new Float64Array(this.needle.length);
    this.ordinal = 0;
    this.prefix = 0;
    this.direction = direction;
    this.overlapping = overlapping;
    this.matchCase = options.matchCase;
    this.budget = budget;
  }

  accept(character, start, end) {
    this.budget.tick();
    const folded = this.matchCase ? character : foldCharacter(character);
    const length = this.needle.length;
    this.positions[this.ordinal % length] = this.direction < 0 ? end : start;
    while (this.prefix > 0 && folded !== this.needle[this.prefix]) {
      this.budget.tick();
      this.prefix = this.failure[this.prefix - 1];
    }
    if (folded === this.needle[this.prefix]) this.prefix++;
    let match = null;
    if (this.prefix === length) {
      const boundary = this.positions[(this.ordinal - length + 1) % length];
      match = this.direction < 0 ? {start, end: boundary, captures: null} : {start: boundary, end, captures: null};
      this.prefix = this.overlapping ? this.failure[length - 1] : 0;
    }
    this.ordinal++;
    return match;
  }

  *matches(text, base = 0) {
    let cursor = this.direction > 0 ? 0 : text.length;
    while (this.direction > 0 ? cursor < text.length : cursor > 0) {
      let start = cursor;
      let end = cursor;
      if (this.direction > 0) end += text.codePointAt(cursor) > 0xffff ? 2 : 1;
      else {
        start--;
        const last = text.charCodeAt(start);
        if (start > 0 && last >= 0xdc00 && last <= 0xdfff) {
          const first = text.charCodeAt(start - 1);
          if (first >= 0xd800 && first <= 0xdbff) start--;
        }
      }
      const match = this.accept(text.slice(start, end), base + start, base + end);
      cursor = this.direction > 0 ? end : start;
      if (match) yield match;
    }
  }
}

/** Linear KMP literal search with UTF-16 spans; Unicode folding never changes the recorded offsets. */
export function* literalMatches(text, query, options, budget) {
  const matcher = new LiteralMatcher(query, options, budget);
  yield* matcher.matches(text);
}

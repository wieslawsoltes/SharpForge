import { Scanner } from '../lexer/scanner.js';
/**
 * The token sequence behind incremental parsing. Tokens carry absolute positions, so after an edit every token behind it
 * would have to be copied; TokenList instead stores segments of token arrays with a position delta each and shifts a
 * token only when it is read. Replacing a window of tokens and moving everything after it costs O(segments).
 */
/** Start of a token's leading trivia and end of its trailing trivia: tokens tile the text by these extents. */
export const leadOf = token => (token.leadingTrivia.length ? token.leadingTrivia[0].start : token.start);
export const tailOf = token => (token.trailingTrivia.length ? token.trailingTrivia[token.trailingTrivia.length - 1].end : token.end);
const shiftPieces = (list, delta) =>
  list.length ? Object.freeze(list.map(piece => Object.freeze({ ...piece, start: piece.start + delta, end: piece.end + delta }))) : list;
/** A copy of `token` moved by `delta`. Interpolated strings hold absolute offsets in their structure, so they are rescanned in place. */
export function shiftToken(token, delta, context) {
  const shifted = {
    ...token,
    start: token.start + delta,
    end: token.end + delta,
    fullStart: token.fullStart + delta,
    leadingTrivia: shiftPieces(token.leadingTrivia, delta),
    trailingTrivia: shiftPieces(token.trailingTrivia, delta)
  };
  if (token.structure) {
    const scanner = new Scanner(context.source, context.cache, { ...context.options, directives: false });
    scanner.i = shifted.start;
    const raw = scanner.token();
    shifted.value = raw.value;
    shifted.structure = raw.structure;
  }
  return Object.freeze(shifted);
}
/**
 * A token sequence stored as segments of token arrays, each with a position delta, so replacing a window of tokens
 * and moving everything after it costs O(segments) instead of O(tokens). Positions are those of the current text.
 */
export class TokenList {
  constructor(segments, context) {
    let base = 0;
    this.segments = segments
      .filter(s => s.to > s.from)
      .map(s => {
        const segment = { tokens: s.tokens, from: s.from, to: s.to, delta: s.delta, base, cache: null };
        base += s.to - s.from;
        return segment;
      });
    this.length = base;
    this.context = context;
    this.view = null;
  }
  static from(tokens, context) {
    return tokens instanceof TokenList ? tokens : new TokenList([{ tokens, from: 0, to: tokens.length, delta: 0 }], context);
  }
  segmentOf(index) {
    const list = this.segments;
    let low = 0,
      high = list.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (list[mid].base <= index) low = mid;
      else high = mid - 1;
    }
    return list[low];
  }
  /** The stored token for `index` without its segment delta applied. */
  raw(index) {
    const s = this.segmentOf(index);
    return s.tokens[s.from + index - s.base];
  }
  get(index) {
    if (index < 0 || index >= this.length) return undefined;
    const s = this.segmentOf(index),
      token = s.tokens[s.from + index - s.base];
    if (!s.delta) return token;
    let shifted = (s.cache ??= new Map()).get(index);
    if (!shifted) s.cache.set(index, (shifted = shiftToken(token, s.delta, this.context)));
    return shifted;
  }
  leadAt(index) {
    const s = this.segmentOf(index);
    return leadOf(s.tokens[s.from + index - s.base]) + s.delta;
  }
  startAt(index) {
    const s = this.segmentOf(index);
    return s.tokens[s.from + index - s.base].start + s.delta;
  }
  endAt(index) {
    const s = this.segmentOf(index);
    return s.tokens[s.from + index - s.base].end + s.delta;
  }
  /** Index of the token whose extent (leading trivia through trailing trivia) contains `position`; the last token at or past the end. */
  indexAt(position) {
    const list = this.segments;
    let low = 0,
      high = list.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1,
        s = list[mid];
      if (leadOf(s.tokens[s.from]) + s.delta <= position) low = mid;
      else high = mid - 1;
    }
    const s = list[low],
      target = position - s.delta;
    let a = s.from,
      b = s.to - 1;
    while (a < b) {
      const mid = (a + b + 1) >> 1;
      if (leadOf(s.tokens[mid]) <= target) a = mid;
      else b = mid - 1;
    }
    return s.base + a - s.from;
  }
  /** Segment descriptors for [from, to) with `delta` added, for building the next list. */
  slice(from, to, delta = 0) {
    const out = [];
    for (const s of this.segments) {
      const a = Math.max(from, s.base),
        b = Math.min(to, s.base + s.to - s.from);
      if (a < b) out.push({ tokens: s.tokens, from: s.from + a - s.base, to: s.from + b - s.base, delta: s.delta + delta });
    }
    return out;
  }
  toArray() {
    const out = new Array(this.length);
    for (let i = 0; i < out.length; i++) out[i] = this.get(i);
    return out;
  }
  /** A list holding the same tokens in one segment (used when many scattered edits have fragmented the list). */
  compact() {
    return this.segments.length <= 1 && !this.segments[0]?.delta
      ? this
      : new TokenList([{ tokens: this.toArray(), from: 0, to: this.length, delta: 0 }], this.context);
  }
  /** A read-only array-like view (index, length, at) for the parser; tokens after an edit are shifted only when read. */
  asArray() {
    if (this.view) return this.view;
    const list = this,
      at = index => list.get(index < 0 ? list.length + index : index);
    return (this.view = new Proxy([], {
      get(target, key) {
        if (key === 'length') return list.length;
        if (key === 'tokenList') return list;
        if (key === 'at') return at;
        if (typeof key === 'string') {
          const c = key.charCodeAt(0);
          if (c >= 48 && c <= 57) return list.get(+key);
        }
        return undefined;
      }
    }));
  }
}

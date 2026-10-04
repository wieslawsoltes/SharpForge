import {bracketPairs} from './operations.js';

const closing = new Map([[')', '('], [']', '['], ['}', '{']]);
const opening = new Set(closing.values());
const cacheLimit = 2048;

export const isHighlightBracket = kind => opening.has(kind) || closing.has(kind);

function bracketSequence(tokens, first, end) {
  let sequence = '';
  for (let index = first; index < end; index++) {
    const kind = tokens.raw(index).kind;
    if (isHighlightBracket(kind)) sequence += kind;
  }
  return sequence;
}

function* positionedTokens(tokens) {
  for (let index = 0; index < (tokens?.length ?? 0); index++) yield tokens.get(index);
}

/** Query the current token stream without copying all shifted tokens into a bracket map. */
export class HighlightBrackets {
  constructor(tokens, previous = null, window = null, change = null) {
    this.tokens = tokens;
    this.cache = new Map();
    this.visited = 0;
    this.complete = null;
    if (!previous?.tokens || !tokens || !window || !change) return;
    if (bracketSequence(previous.tokens, window.first, window.oldEnd) !== bracketSequence(tokens, window.first, window.end)) return;
    // Quote/comment changes can preserve bracket kinds while changing which occurrences are code.
    // Only positions outside the entire rescanned window retain proven token identity.
    const oldEnd = window.endPosition - window.delta;
    const shift = position => position < window.start ? position : position >= oldEnd ? position + window.delta : null;
    for (const [position, partner] of previous.cache) {
      const nextPosition = shift(position);
      const nextPartner = partner === undefined ? undefined : shift(partner);
      if (nextPosition !== null && nextPartner !== null) this.cache.set(nextPosition, nextPartner);
    }
  }

  remember(position, partner) {
    this.cache.set(position, partner);
    if (this.cache.size > cacheLimit) this.cache.delete(this.cache.keys().next().value);
    return partner;
  }

  has(position) { return this.get(position) !== undefined; }

  /** A pathological unmatched/nested stream must not turn repeated visible queries into quadratic scans. */
  materialize() {
    return this.complete ??= bracketPairs('', positionedTokens(this.tokens));
  }

  get size() { return this.materialize().size; }
  entries() { return this.materialize().entries(); }
  keys() { return this.materialize().keys(); }
  values() { return this.materialize().values(); }
  [Symbol.iterator]() { return this.entries(); }
  forEach(callback, context) { this.materialize().forEach((value, key) => callback.call(context, value, key, this)); }

  get(position) {
    if (!this.tokens || !Number.isSafeInteger(position) || position < 0) return undefined;
    if (this.complete) return this.complete.get(position);
    if (this.cache.has(position)) return this.cache.get(position);
    const index = this.tokens.indexAt(position);
    if (this.tokens.startAt(index) !== position) return undefined;
    const kind = this.tokens.raw(index).kind;
    if (!isHighlightBracket(kind)) return undefined;
    const forward = opening.has(kind);
    const stack = [kind];
    for (let next = index + (forward ? 1 : -1); next >= 0 && next < this.tokens.length; next += forward ? 1 : -1) {
      if (++this.visited > this.tokens.length) return this.materialize().get(position);
      const candidate = this.tokens.raw(next).kind;
      if (!isHighlightBracket(candidate)) continue;
      if (forward ? opening.has(candidate) : closing.has(candidate)) stack.push(candidate);
      else {
        const expected = stack.pop();
        if (forward ? closing.get(candidate) !== expected : closing.get(expected) !== candidate) {
          return this.remember(position, undefined);
        }
        if (!stack.length) {
          const partner = this.tokens.startAt(next);
          this.remember(partner, position);
          return this.remember(position, partner);
        }
      }
    }
    return this.remember(position, undefined);
  }
}

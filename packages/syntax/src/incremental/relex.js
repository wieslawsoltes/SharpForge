import { diagnostic, BoundedCache } from '@sharpforge/text';
import { Scanner } from '../lexer/scanner.js';
import { scanTrivia } from '../lexer/trivia.js';
import { DirectiveState, unterminatedDirectives } from '../directives/conditional.js';
/**
 * Bounded incremental relexing. After a text change only a window of tokens is rescanned: it starts at a token
 * boundary before the edit where the old scan cannot have looked past (trivia separates the tokens) and ends where the
 * new scan reaches an old token boundary after the edit in the same preprocessor state. Tokens before the window are
 * the old objects; tokens after it are the old objects too when the edit keeps the length, otherwise position-shifted
 * copies that share the value, interned text and trivia structure (made on demand by TokenList).
 */
const empty = Object.freeze([]);
/** Start of a token's leading trivia and end of its trailing trivia: tokens tile the text by these extents. */
export const leadOf = token => token.leadingTrivia.length ? token.leadingTrivia[0].start : token.start;
export const tailOf = token => token.trailingTrivia.length ? token.trailingTrivia[token.trailingTrivia.length - 1].end : token.end;
const shiftPieces = (list, delta) => list.length ? Object.freeze(list.map(piece => Object.freeze({ ...piece, start: piece.start + delta, end: piece.end + delta }))) : list;
/** A copy of `token` moved by `delta`. Interpolated strings hold absolute offsets in their structure, so they are rescanned in place. */
export function shiftToken(token, delta, context) {
  const shifted = { ...token, start: token.start + delta, end: token.end + delta, fullStart: token.fullStart + delta, leadingTrivia: shiftPieces(token.leadingTrivia, delta), trailingTrivia: shiftPieces(token.trailingTrivia, delta) };
  if (token.structure) { const scanner = new Scanner(context.source, context.cache, { ...context.options, directives: false }); scanner.i = shifted.start; const raw = scanner.token(); shifted.value = raw.value; shifted.structure = raw.structure; }
  return Object.freeze(shifted);
}
/**
 * A token sequence stored as segments of token arrays, each with a position delta, so replacing a window of tokens
 * and moving everything after it costs O(segments) instead of O(tokens). Positions are those of the current text.
 */
export class TokenList {
  constructor(segments, context) {
    let base = 0; this.segments = segments.filter(s => s.to > s.from).map(s => { const segment = { tokens: s.tokens, from: s.from, to: s.to, delta: s.delta, base, cache: null }; base += s.to - s.from; return segment; });
    this.length = base; this.context = context; this.view = null;
  }
  static from(tokens, context) { return tokens instanceof TokenList ? tokens : new TokenList([{ tokens, from: 0, to: tokens.length, delta: 0 }], context); }
  segmentOf(index) { const list = this.segments; let low = 0, high = list.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (list[mid].base <= index) low = mid; else high = mid - 1; } return list[low]; }
  /** The stored token for `index` without its segment delta applied. */
  raw(index) { const s = this.segmentOf(index); return s.tokens[s.from + index - s.base]; }
  get(index) {
    if (index < 0 || index >= this.length) return undefined;
    const s = this.segmentOf(index), token = s.tokens[s.from + index - s.base]; if (!s.delta) return token;
    let shifted = (s.cache ??= new Map()).get(index); if (!shifted) s.cache.set(index, shifted = shiftToken(token, s.delta, this.context)); return shifted;
  }
  leadAt(index) { const s = this.segmentOf(index); return leadOf(s.tokens[s.from + index - s.base]) + s.delta; }
  startAt(index) { const s = this.segmentOf(index); return s.tokens[s.from + index - s.base].start + s.delta; }
  endAt(index) { const s = this.segmentOf(index); return s.tokens[s.from + index - s.base].end + s.delta; }
  /** Index of the token whose extent (leading trivia through trailing trivia) contains `position`; the last token at or past the end. */
  indexAt(position) {
    const list = this.segments; let low = 0, high = list.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1, s = list[mid]; if (leadOf(s.tokens[s.from]) + s.delta <= position) low = mid; else high = mid - 1; }
    const s = list[low], target = position - s.delta; let a = s.from, b = s.to - 1;
    while (a < b) { const mid = (a + b + 1) >> 1; if (leadOf(s.tokens[mid]) <= target) a = mid; else b = mid - 1; }
    return s.base + a - s.from;
  }
  /** Segment descriptors for [from, to) with `delta` added, for building the next list. */
  slice(from, to, delta = 0) {
    const out = [];
    for (const s of this.segments) { const a = Math.max(from, s.base), b = Math.min(to, s.base + s.to - s.from); if (a < b) out.push({ tokens: s.tokens, from: s.from + a - s.base, to: s.from + b - s.base, delta: s.delta + delta }); }
    return out;
  }
  toArray() { const out = new Array(this.length); for (let i = 0; i < out.length; i++) out[i] = this.get(i); return out; }
  /** A list holding the same tokens in one segment (used when many scattered edits have fragmented the list). */
  compact() { return this.segments.length <= 1 && !this.segments[0]?.delta ? this : new TokenList([{ tokens: this.toArray(), from: 0, to: this.length, delta: 0 }], this.context); }
  /** A read-only array-like view (index, length, at) for the parser; tokens after an edit are shifted only when read. */
  asArray() {
    if (this.view) return this.view; const list = this, at = index => list.get(index < 0 ? list.length + index : index);
    return this.view = new Proxy([], { get(target, key) { if (key === 'length') return list.length; if (key === 'tokenList') return list; if (key === 'at') return at; if (typeof key === 'string') { const c = key.charCodeAt(0); if (c >= 48 && c <= 57) return list.get(+key); } return undefined; } });
  }
}
/** The state snapshot in force at `position`: that of the last directive ending at or before it, or null for the initial state. */
function stateAt(checkpoints, position, delta = 0) {
  let low = 0, high = checkpoints.length;
  while (low < high) { const mid = (low + high) >> 1; if (checkpoints[mid].end <= position) low = mid + 1; else high = mid; }
  return low ? checkpoints[low - 1].state : null;
}
const sameEntry = (a, b) => { const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]); };
function stateEquals(state, snapshot, initialSymbols) {
  const symbols = snapshot ? snapshot.symbols : initialSymbols, stack = snapshot ? snapshot.stack : empty;
  return state.sawIf === (snapshot ? snapshot.sawIf : false) && state.symbols.size === symbols.size && [...state.symbols].every(symbol => symbols.has(symbol))
    && state.stack.length === stack.length && state.stack.every((entry, index) => sameEntry(entry, stack[index]));
}
const shiftSpan = (item, delta) => delta ? { ...item, start: item.start + delta, end: item.end + delta } : item;
const lowerBound = (list, position) => { let low = 0, high = list.length; while (low < high) { const mid = (low + high) >> 1; if (list[mid].start < position) low = mid + 1; else high = mid; } return low; };
/**
 * Relexes after one text change. `old` is a lex() or relex result for the previous text, `source` the new SourceText
 * and `change` = { start, length, newLength } in old coordinates (`newLength` characters replace `length`).
 * Returns the lex() result shape with `tokens` as a TokenList and `window` = { first, end, oldEnd, start, endPosition,
 * delta }: tokens [first, end) were rescanned and replace old tokens [first, oldEnd); `start`/`endPosition` are the
 * window's extent in the new text.
 */
export function relexTokens(old, source, change, cache = new BoundedCache(), options = {}) {
  const context = { source, cache, options }, list = old.tokenList ?? TokenList.from(old.tokens, context), count = list.length, delta = change.newLength - change.length, oldChangeEnd = change.start + change.length, changeEnd = change.start + change.newLength;
  const checkpoints = old.checkpoints ?? empty, initialSymbols = new Set(options.preprocessorSymbols ?? []);
  // Back up to a boundary with trivia between the tokens: a scan that stopped at trivia cannot depend on the text after it.
  let first = Math.max(0, list.indexAt(change.start) - 1), guard = 0;
  for (; first > 0 && guard < 256; guard++, first--) if (list.raw(first - 1).trailingTrivia.length || list.raw(first).leadingTrivia.length) break;
  if (guard === 256) first = 0;
  const start = first ? list.leadAt(first) : 0, scanner = new Scanner(source, cache, options), before = stateAt(checkpoints, start);
  if (before) { scanner.state = new DirectiveState(before.symbols); scanner.state.stack = before.stack.map(entry => ({ ...entry })); scanner.state.sawIf = before.sawIf; scanner.lastSnapshot = before; }
  scanner.state.seenToken = first > 0; scanner.i = start;
  const raws = []; let pending = scanTrivia(scanner, false).leading, oldEnd = count, endPosition = source.length + 1, syncing = -1;
  for (;;) {
    const raw = scanner.token(); raw.leading = pending; raws.push(raw); if (raw.kind === 'eof') break;
    if ((raws.length & 255) === 0 && options.cancellationToken) options.cancellationToken.throwIfCancellationRequested();
    scanner.state.seenToken = true; const trivia = scanTrivia(scanner, true); raw.trailing = trivia.trailing; pending = trivia.leading;
    const lead = pending.length ? pending[0].start : scanner.i;
    // One more token is rescanned after the streams meet, so the token after the window keeps its old distance to its predecessor.
    if (syncing >= 0) { if (raw.end - delta === list.endAt(syncing) && raw.kind === list.raw(syncing).kind) { oldEnd = syncing + 1; endPosition = lead; break; } syncing = -1; }
    if (lead >= changeEnd && lead - delta >= oldChangeEnd) {
      const index = list.indexAt(lead - delta);
      if (index < count - 1 && list.leadAt(index) === lead - delta && list.startAt(index) === scanner.i - delta && stateEquals(scanner.state, stateAt(checkpoints, list.startAt(index)), initialSymbols)) syncing = index;
    }
  }
  const tokens = scanner.finish(raws, first ? list.endAt(first - 1) : 0), resynced = oldEnd < count, oldBoundary = endPosition - delta;
  if (!resynced) for (const [code, message] of unterminatedDirectives(scanner.state)) scanner.error(source.length, 0, code, message);
  const rebuild = d => diagnostic(source, d.start, d.length, d.code, d.message, d.severity);
  const merge = (previous, fresh, map, shift) => {
    const out = []; for (const item of previous) { if (item.start >= start) break; out.push(map ? map(item) : item); }
    for (const item of fresh) if (item.start < endPosition) out.push(item);
    if (resynced) for (let i = lowerBound(previous, oldBoundary); i < previous.length; i++) out.push(shift(previous[i]));
    return out;
  };
  const sorted = list => list.every((item, index) => !index || list[index - 1].start <= item.start) ? list : [...list].sort((a, b) => a.start - b.start);
  const shiftDiagnostic = d => diagnostic(source, d.start + delta, d.length, d.code, d.message, d.severity), shiftItem = item => shiftSpan(item, delta);
  const lexical = merge(sorted(old.lexicalDiagnostics ?? old.diagnostics), scanner.diagnostics, rebuild, shiftDiagnostic), profile = merge(sorted(old.profileDiagnostics ?? empty), scanner.profile, rebuild, shiftDiagnostic);
  const result = {
    source, tokens: new TokenList([...list.slice(0, first), { tokens, from: 0, to: tokens.length, delta: 0 }, ...list.slice(oldEnd, count, delta)], context),
    diagnostics: options.profile === false ? [...lexical] : [...lexical, ...profile].sort((a, b) => a.start - b.start), internedTokenHits: scanner.reused,
    directives: Object.freeze(merge(old.directives, scanner.directives, null, piece => Object.freeze(shiftSpan(piece, delta)))), features: merge(sorted(old.features), scanner.features, null, shiftItem),
    lexicalDiagnostics: lexical, profileDiagnostics: profile, symbols: resynced ? old.symbols : scanner.state.symbols,
    checkpoints: merge(checkpoints, scanner.checkpoints, null, shiftItem),
    window: { first, end: first + tokens.length, oldEnd, start, endPosition: Math.min(endPosition, source.length), delta, resynced }
  };
  if (result.tokens.segments.length > 64) result.tokens = result.tokens.compact();
  return result;
}
/** relexTokens() with `tokens` materialised as a frozen array, the shape lex() returns. */
export function relex(old, source, change, cache = new BoundedCache(), options = {}) { const result = relexTokens(old, source, change, cache, options); const tokens = Object.freeze(result.tokens.toArray()); return { ...result, tokenList: TokenList.from(tokens, result.tokens.context), tokens }; }

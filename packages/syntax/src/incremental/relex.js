import { diagnostic, BoundedCache } from '@sharpforge/text';
import { Scanner } from '../lexer/scanner.js';
import { scanTrivia } from '../lexer/trivia.js';
import { DirectiveState, unterminatedDirectives } from '../directives/conditional.js';
import { TokenList } from './token-list.js';
/**
 * Bounded incremental relexing. After a text change only a window of tokens is rescanned: it starts at a token
 * boundary before the edit where the old scan cannot have looked past (trivia separates the tokens) and ends where the
 * new scan reaches an old token boundary after the edit in the same preprocessor state. Tokens before the window are
 * the old objects; tokens after it are the old objects too when the edit keeps the length, otherwise position-shifted
 * copies that share the value, interned text and trivia structure (made on demand by TokenList).
 */
const empty = Object.freeze([]);
const byStart = (a, b) => a.start - b.start;

/** The state snapshot in force at `position`: that of the last directive ending at or before it, or null for the initial state. */
function stateAt(checkpoints, position) {
  let low = 0;
  let high = checkpoints.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (checkpoints[mid].end <= position) low = mid + 1;
    else high = mid;
  }
  return low ? checkpoints[low - 1].state : null;
}

function sameStackEntry(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/** True when the scanner's live preprocessor state equals a recorded snapshot (null stands for the initial state). */
function stateEquals(state, snapshot, initialSymbols) {
  const symbols = snapshot ? snapshot.symbols : initialSymbols;
  const stack = snapshot ? snapshot.stack : empty;
  if (state.sawIf !== (snapshot ? snapshot.sawIf : false)) return false;
  if (state.symbols.size !== symbols.size || state.stack.length !== stack.length) return false;
  for (const symbol of state.symbols) if (!symbols.has(symbol)) return false;
  return state.stack.every((entry, index) => sameStackEntry(entry, stack[index]));
}

/** Index of the first item starting at or after `position` in a list sorted by start. */
function lowerBound(list, position) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid].start < position) low = mid + 1;
    else high = mid;
  }
  return low;
}

function sortedByStart(list) {
  const isSorted = list.every((item, index) => index === 0 || list[index - 1].start <= item.start);
  return isSorted ? list : [...list].sort(byStart);
}

/**
 * The index of the first token to rescan: the token before the one the change starts in, moved back further until
 * trivia separates it from its predecessor. A scan that stopped at trivia cannot depend on the text after it, so
 * everything before that boundary is unaffected by the change. Without such a boundary nearby the whole text is rescanned.
 */
function windowStartIndex(list, changeStart) {
  let first = Math.max(0, list.indexAt(changeStart) - 1);
  for (let steps = 0; first > 0; steps++, first--) {
    if (steps === 256) return 0;
    if (list.raw(first - 1).trailingTrivia.length || list.raw(first).leadingTrivia.length) break;
  }
  return first;
}

/** A scanner positioned at `start` in the preprocessor state the old scan had there. */
function resumeScanner(context, checkpoints, start, hasPrecedingToken) {
  const scanner = new Scanner(context.source, context.cache, context.options);
  const snapshot = stateAt(checkpoints, start);
  if (snapshot) {
    scanner.state = new DirectiveState(snapshot.symbols);
    scanner.state.stack = snapshot.stack.map(entry => ({ ...entry }));
    scanner.state.sawIf = snapshot.sawIf;
    scanner.lastSnapshot = snapshot;
  }
  scanner.state.seenToken = hasPrecedingToken;
  scanner.i = start;
  return scanner;
}

/**
 * Scans tokens from the scanner's position until the new stream meets the old one after the change: the next token
 * starts at an old token boundary, with the same leading trivia start and the same preprocessor state. One more token
 * is rescanned after the streams meet, so the first reused token keeps its old distance to its predecessor.
 * Returns { raws, oldEnd, endPosition }: the scan records, the old index of the first reused token (the old token count
 * when the scan ran to the end of the text) and where the window ends in the new text.
 */
function scanWindow(scanner, list, checkpoints, edit) {
  const { delta, oldChangeEnd, changeEnd, initialSymbols, cancellationToken } = edit;
  const lastIndex = list.length - 1;
  const raws = [];
  let pending = scanTrivia(scanner, false).leading;
  let meetingIndex = -1;
  for (;;) {
    const raw = scanner.token();
    raw.leading = pending;
    raws.push(raw);
    if (raw.kind === 'eof') return { raws, oldEnd: list.length, endPosition: scanner.source.length + 1 };
    if ((raws.length & 255) === 0 && cancellationToken) cancellationToken.throwIfCancellationRequested();
    scanner.state.seenToken = true;
    const trivia = scanTrivia(scanner, true);
    raw.trailing = trivia.trailing;
    pending = trivia.leading;
    const nextLead = pending.length ? pending[0].start : scanner.i;
    if (meetingIndex >= 0) {
      const confirmed = raw.end - delta === list.endAt(meetingIndex) && raw.kind === list.raw(meetingIndex).kind;
      if (confirmed) return { raws, oldEnd: meetingIndex + 1, endPosition: nextLead };
      meetingIndex = -1;
    }
    if (nextLead < changeEnd || nextLead - delta < oldChangeEnd) continue;
    const index = list.indexAt(nextLead - delta);
    const atOldBoundary = index < lastIndex && list.leadAt(index) === nextLead - delta && list.startAt(index) === scanner.i - delta;
    if (atOldBoundary && stateEquals(scanner.state, stateAt(checkpoints, list.startAt(index)), initialSymbols)) meetingIndex = index;
  }
}

/**
 * Builds a position-sorted list for the new text from the old list and the items the window scan produced: old items
 * before the window (optionally re-created by `renew`), fresh items inside it, and old items after it moved by `shift`.
 */
function mergeByPosition(previous, fresh, bounds, { renew = null, shift }) {
  const merged = [];
  for (const item of previous) {
    if (item.start >= bounds.start) break;
    merged.push(renew ? renew(item) : item);
  }
  for (const item of fresh) if (item.start < bounds.endPosition) merged.push(item);
  if (bounds.resynced) {
    for (let index = lowerBound(previous, bounds.oldBoundary); index < previous.length; index++) merged.push(shift(previous[index]));
  }
  return merged;
}

/**
 * Relexes after one text change. `old` is a lex() or relex result for the previous text, `source` the new SourceText
 * and `change` = { start, length, newLength } in old coordinates (`newLength` characters replace `length`).
 * Returns the lex() result shape with `tokens` as a TokenList and `window` = { first, end, oldEnd, start, endPosition,
 * delta, resynced }: tokens [first, end) were rescanned and replace old tokens [first, oldEnd); `start`/`endPosition`
 * are the window's extent in the new text. Throws OperationCanceledError when `options.cancellationToken` is cancelled.
 */
export function relexTokens(old, source, change, cache = new BoundedCache(), options = {}) {
  const context = { source, cache, options };
  const list = old.tokenList ?? TokenList.from(old.tokens, context);
  const checkpoints = old.checkpoints ?? empty;
  const delta = change.newLength - change.length;
  const first = windowStartIndex(list, change.start);
  const start = first ? list.leadAt(first) : 0;
  const scanner = resumeScanner(context, checkpoints, start, first > 0);
  const { raws, oldEnd, endPosition } = scanWindow(scanner, list, checkpoints, {
    delta,
    oldChangeEnd: change.start + change.length,
    changeEnd: change.start + change.newLength,
    initialSymbols: new Set(options.preprocessorSymbols ?? []),
    cancellationToken: options.cancellationToken
  });
  const tokens = scanner.finish(raws, first ? list.endAt(first - 1) : 0);
  const resynced = oldEnd < list.length;
  if (!resynced) for (const [code, message] of unterminatedDirectives(scanner.state)) scanner.error(source.length, 0, code, message);

  const bounds = { start, endPosition, oldBoundary: endPosition - delta, resynced };
  const moveSpan = item => (delta ? { ...item, start: item.start + delta, end: item.end + delta } : item);
  // Diagnostics carry the source version and line positions, so those outside the window are re-created for the new text.
  const diagnostics = {
    renew: d => diagnostic(source, d.start, d.length, d.code, d.message, d.severity),
    shift: d => diagnostic(source, d.start + delta, d.length, d.code, d.message, d.severity)
  };
  const lexical = mergeByPosition(sortedByStart(old.lexicalDiagnostics ?? old.diagnostics), scanner.diagnostics, bounds, diagnostics);
  const profile = mergeByPosition(sortedByStart(old.profileDiagnostics ?? empty), scanner.profile, bounds, diagnostics);
  const segments = [...list.slice(0, first), { tokens, from: 0, to: tokens.length, delta: 0 }, ...list.slice(oldEnd, list.length, delta)];
  const tokenList = new TokenList(segments, context);
  return {
    source,
    tokens: tokenList.segments.length > 64 ? tokenList.compact() : tokenList,
    diagnostics: options.profile === false ? [...lexical] : [...lexical, ...profile].sort(byStart),
    internedTokenHits: scanner.reused,
    directives: Object.freeze(mergeByPosition(old.directives, scanner.directives, bounds, { shift: piece => Object.freeze(moveSpan(piece)) })),
    features: mergeByPosition(sortedByStart(old.features), scanner.features, bounds, { shift: moveSpan }),
    lexicalDiagnostics: lexical,
    profileDiagnostics: profile,
    symbols: resynced ? old.symbols : scanner.state.symbols,
    checkpoints: mergeByPosition(checkpoints, scanner.checkpoints, bounds, { shift: moveSpan }),
    window: { first, end: first + tokens.length, oldEnd, start, endPosition: Math.min(endPosition, source.length), delta, resynced }
  };
}

/** relexTokens() with `tokens` materialised as a frozen array, the shape lex() returns. */
export function relex(old, source, change, cache = new BoundedCache(), options = {}) {
  const result = relexTokens(old, source, change, cache, options);
  const tokens = Object.freeze(result.tokens.toArray());
  return { ...result, tokenList: TokenList.from(tokens, result.tokens.context), tokens };
}

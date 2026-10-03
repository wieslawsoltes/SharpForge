import { diagnostic } from '@sharpforge/text';
import { GreenCache } from '../green.js';
import { legacyContextual, contextualKeywordKinds, reservedKeywordKinds, predefinedTypes } from '../lexer/keywords.js';
import { punctuationKinds, greaterThanMerges } from '../lexer/operators.js';
import { recoveryMethods } from './recovery.js';
const expected = { ';': ['CS1002', '; expected'], '}': ['CS1513', '} expected'], '{': ['CS1514', '{ expected'], ')': ['CS1026', ') expected'] };
const empty = Object.freeze([]);
/**
 * Token cursor and green-node builder shared by every parser module. Parsing methods are mixed into the
 * prototype by parser.js; each consumes lexer tokens and returns GreenNode / GreenToken values, so every
 * consumed character ends up in the tree.
 */
export class Parser {
  constructor(lexed, options = {}) {
    this.source = lexed.source; this.tokens = lexed.tokens; this.lexed = lexed; this.options = options;
    this.diagnostics = [...(lexed.lexicalDiagnostics ?? lexed.diagnostics)]; this.features = [...(lexed.features ?? [])];
    this.cache = options.greenCache ?? GreenCache.for(options.cache); this.i = 0; this.depth = 0; this.nodeCount = 0; this.skippedTokens = [];
    // `await` is a keyword at statement level only inside async functions and top-level statements, as in Roslyn.
    this.inAsync = options.inAsync ?? true;
  }
  get current() { return this.tokens[this.i]; }
  at(kind) { return this.tokens[this.i].kind === kind; }
  atAny(kinds) { return kinds.includes(this.tokens[this.i].kind); }
  peek(n = 1) { return this.tokens[Math.min(this.tokens.length - 1, this.i + n)]; }
  kindAt(index) { return this.tokens[Math.min(this.tokens.length - 1, index)].kind; }
  /** Identifier tokens, including the contextual words the token stream reports as keywords. */
  isId(token = this.current) { return token.kind === 'identifier' || legacyContextual.has(token.kind); }
  /** True when the token is the contextual keyword `word` (never when @-escaped). */
  isWord(token, word) { return (token.kind === 'identifier' || token.kind === word) && token.value === word && !token.flags; }
  atWord(word) { return this.isWord(this.tokens[this.i], word); }
  isPredefined(token = this.current) { return predefinedTypes.has(token.kind) && token.syntaxKind.endsWith('Keyword'); }
  error(token, code, message, severity) {
    if (this.diagnostics.length >= 200) return;
    const start = token.start, length = Math.max(1, token.end - token.start);
    this.diagnostics.push(diagnostic(this.source, start, length, code, message, severity));
  }
  feature(id, token, end = token) { this.features.push({ id, start: token.start, end: end.end ?? end }); }
  trivia(pieces) {
    if (!pieces.length) return empty; const text = this.source.text, out = [];
    for (const piece of pieces) out.push(this.cache.trivia(piece.kind, text.slice(piece.start, piece.end), piece.structure ?? null));
    return this.cache.triviaList(out);
  }
  /** Builds the green token for a lexer token, prepending any tokens skipped during recovery as SkippedTokensTrivia. */
  green(token, kind = token.syntaxKind, text = token.text, trailing = token.trailingTrivia) {
    let leading = this.trivia(token.leadingTrivia);
    if (this.skippedTokens.length) leading = Object.freeze([this.takeSkipped(), ...leading]);
    const value = token.literal ?? (kind === 'IdentifierToken' || token.syntaxKind.endsWith('LiteralToken') ? token.value : undefined);
    return this.cache.token(kind, text, value, leading, this.trivia(trailing));
  }
  take(kind) { const token = this.tokens[this.i]; if (token.kind !== 'eof') this.i++; return this.green(token, kind); }
  /** Consumes the current identifier-like token as the given contextual keyword. */
  takeWord(word) { return this.take(contextualKeywordKinds[word]); }
  match(kind) { return this.at(kind) ? this.take() : null; }
  matchWord(word) { return this.atWord(word) ? this.takeWord(word) : null; }
  missing(kind) { return this.cache.missing(punctuationKinds[kind] ?? reservedKeywordKinds[kind] ?? kind); }
  expect(kind) {
    if (this.at(kind)) return this.take();
    const [code, message] = expected[kind] ?? ['CS1003', `Syntax error, '${kind}' expected`];
    this.error(this.errorAnchor(), code, message); return this.missing(kind);
  }
  /** Missing-token errors point at the end of the previous token, where the token should have been. */
  errorAnchor() { const previous = this.tokens[this.i - 1]; return previous && this.current.start > previous.end ? { start: previous.end, end: previous.end } : this.current; }
  id() {
    if (this.isId()) return this.take('IdentifierToken');
    this.error(this.current, 'CS1001', 'Identifier expected'); return this.cache.missing('IdentifierToken');
  }
  /** True when the tokens at `index` and `index + 1` touch (no trivia between), as required to merge `>` `>` into `>>`. */
  adjacent(index) { const a = this.tokens[index], b = this.tokens[index + 1]; return !!b && a.end === b.start; }
  /** The operator text at the cursor with `>`-family operators assembled from adjacent tokens: { text, count }. */
  operatorAt(index = this.i) {
    const kind = this.kindAt(index);
    if (kind === '>') for (const [parts, text] of greaterThanMerges) if (parts.every((part, k) => this.kindAt(index + k) === part && (k === 0 || this.adjacent(index + k - 1))) && index + parts.length <= this.tokens.length) return { text, count: parts.length };
    return { text: kind, count: 1 };
  }
  /** Consumes `count` adjacent tokens as one operator token. */
  takeOperator({ text, count }) {
    if (count === 1) return this.take();
    const first = this.tokens[this.i], last = this.tokens[this.i + count - 1]; this.i += count;
    return this.green(first, punctuationKinds[text], text, last.trailingTrivia);
  }
  /** Creates a green node; arrays become lists (null when empty) and `undefined` children become null. */
  n(kind, ...children) {
    this.nodeCount++;
    for (let k = 0; k < children.length; k++) { const child = children[k]; if (Array.isArray(child)) children[k] = this.cache.list(child); else if (child === undefined) children[k] = null; }
    return this.cache.node(kind, children);
  }
  /** Checkpoint for speculative parsing; reset() discards tokens, diagnostics and feature uses recorded since. */
  mark() { return [this.i, this.diagnostics.length, this.features.length, this.skippedTokens.slice(), this.depth]; }
  reset(mark) { this.i = mark[0]; this.diagnostics.length = mark[1]; this.features.length = mark[2]; this.skippedTokens = mark[3].slice(); this.depth = mark[4]; }
  guardProgress(before) { if (before === this.i && !this.at('eof')) { this.error(this.current, 'CS1525', `Unexpected token '${this.current.text}'`); this.skip(); } }
  enter(message = 'Syntax nesting limit exceeded') { if (++this.depth <= 200) return true; this.error(this.current, 'SF1099', message); return false; }
  leave() { this.depth--; }
}
Object.assign(Parser.prototype, recoveryMethods);

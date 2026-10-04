import { diagnostic } from '@sharpforge/text';
import { GreenCache, ownText } from '../green.js';
import { legacyContextual, contextualKeywordKinds, previewContextualKeywordKinds, reservedKeywordKinds, predefinedTypes } from '../lexer/keywords.js';
import { parseLanguageVersion, previewLanguageVersion } from '../langversion.js';
import { punctuationKinds, greaterThanMerges } from '../lexer/operators.js';
import { recoveryMethods } from './recovery.js';
import { blenderMethods } from '../incremental/blender.js';
import { budgetMethods } from './budget.js';
const expected = { ';': ['CS1002', '; expected'], '}': ['CS1513', '} expected'], '{': ['CS1514', '{ expected'], ')': ['CS1026', ') expected'] };
const empty = Object.freeze([]);
/**
 * Token cursor and green-node builder shared by every parser module. Parsing methods are mixed into the
 * prototype by parser.js; each consumes lexer tokens and returns GreenNode / GreenToken values, so every
 * consumed character ends up in the tree.
 */
export class Parser {
  constructor(lexed, options = {}) {
    this.source = lexed.source;
    this.tokens = lexed.tokens;
    this.lexed = lexed;
    this.options = options;
    this.diagnostics = [...(lexed.lexicalDiagnostics ?? lexed.diagnostics)];
    this.features = [...(lexed.features ?? [])];
    this.cache = options.greenCache ?? GreenCache.for(options.cache);
    this.i = 0;
    this.depth = 0;
    this.nodeCount = 0;
    this.skippedTokens = [];
    // `await` is a keyword at statement level only inside async functions and top-level statements, as in Roslyn.
    this.inAsync = options.inAsync ?? true;
    // Incremental parsing: a Blender over the previous tree (see incremental/blender.js), or null for a full parse.
    this.blend = options.blend ?? null;
    // The language version steers the few places where a contextual keyword changed meaning by version (record, extension)
    // and enables preview grammar; without one the parser accepts everything, as LangVersion preview does.
    const version = options.languageVersion;
    this.languageVersion =
      version === undefined || version === null ? previewLanguageVersion : (parseLanguageVersion(version)?.number ?? previewLanguageVersion);
    this.inExtension = false;
    this.closedAt = null;
    this.owner = null;
    this.budgetExhausted = false;
    this.cancellation = options.cancellationToken ?? null;
    this.ticks = 0;
    // Expression variables declared in initializers (true) and query clauses ('clause') need C# 7.3 (see csharp73.js).
    this.restrictedVariables = false;
    this.queryEnclosing = false;
    this.memberStart = 0;
    this.memberErrors = 0;
    this.statementStart = 0;
    // The member being parsed: its modifier tokens [memberModifiers, memberModifiersEnd), its name token, and the kind of its type.
    this.memberModifiers = 0;
    this.memberModifiersEnd = 0;
    this.memberName = null;
    this.containerKind = null;
    this.accessorBodies = 0;
    this.typeDepth = 0;
    // The index where the member modifiers of a top-level function end while that function is being parsed (see top-level.js).
    this.topLevelModifiersEnd = 0;
    // True inside the accessors of a property from C# 14 on, where `field` is the backing-field keyword.
    this.fieldKeyword = false;
    // The namespace-like node whose members are being parsed and the token that closes it (null for the end of file).
    this.namespaceKind = null;
    this.namespaceClose = null;
    // True while the first element of a parenthesised expression or tuple is parsed (it declares a variable only before a comma).
    this.tupleFirst = false;
  }
  get current() {
    return this.tokens[this.i];
  }
  at(kind) {
    return this.tokens[this.i].kind === kind;
  }
  atAny(kinds) {
    return kinds.includes(this.tokens[this.i].kind);
  }
  peek(n = 1) {
    return this.tokens[Math.min(this.tokens.length - 1, this.i + n)];
  }
  kindAt(index) {
    return this.tokens[Math.min(this.tokens.length - 1, index)].kind;
  }
  /** Identifier tokens, including the contextual words the token stream reports as keywords. */
  isId(token = this.current) {
    return token.kind === 'identifier' || legacyContextual.has(token.kind);
  }
  /** True when the token is the contextual keyword `word` (never when @-escaped). */
  isWord(token, word) {
    return (token.kind === 'identifier' || token.kind === word) && token.value === word && !token.flags;
  }
  atWord(word) {
    return this.isWord(this.tokens[this.i], word);
  }
  isPredefined(token = this.current) {
    return predefinedTypes.has(token.kind) && token.syntaxKind.endsWith('Keyword');
  }
  error(token, code, message, severity) {
    if (this.diagnostics.length >= 200) return;
    const start = token.start,
      length = Math.max(1, token.end - token.start);
    this.diagnostics.push(diagnostic(this.source, start, length, code, message, severity));
  }
  /**
   * Records a use of catalog feature `id` over the tokens `token` to `end`. `modifier` names the modifier that needs
   * the feature when the diagnostic is "the modifier is not valid for this item" rather than the generic one.
   */
  feature(id, token, end = token, modifier) {
    const use = { id, start: token.start, end: end.end ?? end };
    if (modifier) use.modifier = modifier;
    this.features.push(use);
  }
  trivia(pieces) {
    if (!pieces.length) return empty;
    const text = this.source.text;
    if (pieces.length === 1) {
      const piece = pieces[0];
      return this.cache.trivia(piece.kind, ownText(text.slice(piece.start, piece.end)), piece.structure ?? null).asList;
    }
    const out = [];
    for (const piece of pieces) out.push(this.cache.trivia(piece.kind, ownText(text.slice(piece.start, piece.end)), piece.structure ?? null));
    return this.cache.triviaList(out);
  }
  /** Builds the green token for a lexer token, prepending any tokens skipped during recovery as SkippedTokensTrivia. */
  green(token, kind = token.syntaxKind, text = token.text, trailing = token.trailingTrivia) {
    let leading = this.trivia(token.leadingTrivia);
    if (this.skippedTokens.length) leading = Object.freeze([this.takeSkipped(), ...leading]);
    const value = token.literal ?? (kind === 'IdentifierToken' || token.syntaxKind.endsWith('LiteralToken') ? token.value : undefined);
    return this.cache.token(kind, text, value, leading, this.trivia(trailing));
  }
  take(kind) {
    const token = this.tokens[this.i];
    if (token.kind !== 'eof') this.i++;
    return this.green(token, kind);
  }
  /** Consumes the current identifier-like token as the given contextual keyword. */
  takeWord(word) {
    return this.take(contextualKeywordKinds[word] ?? previewContextualKeywordKinds[word]);
  }
  match(kind) {
    return this.at(kind) ? this.take() : null;
  }
  matchWord(word) {
    return this.atWord(word) ? this.takeWord(word) : null;
  }
  missing(kind) {
    return this.cache.missing(punctuationKinds[kind] ?? reservedKeywordKinds[kind] ?? kind);
  }
  expect(kind) {
    if (this.at(kind)) return this.take();
    const [code, message] = expected[kind] ?? ['CS1003', `Syntax error, '${kind}' expected`];
    this.error(kind === ':' ? this.current : this.errorAnchor(), code, message);
    return this.missing(kind);
  }
  /** Roslyn anchors a missing token before a following line break, otherwise on the current token. */
  errorAnchor() {
    const previous = this.tokens[this.i - 1];
    if (!previous || this.current.start <= previous.end) return this.current;
    const trivia = this.source.text.slice(previous.end, this.current.start);
    const followsLineBreak = /[\r\n\u0085\u2028\u2029]/.test(trivia);
    return this.current.kind === 'eof' || followsLineBreak
      ? { start: previous.end, end: previous.end }
      : this.current;
  }
  id() {
    if (this.isId()) return this.take('IdentifierToken');
    this.error(this.errorAnchor(), 'CS1001', 'Identifier expected');
    return this.cache.missing('IdentifierToken');
  }
  /** True when the tokens at `index` and `index + 1` touch (no trivia between), as required to merge `>` `>` into `>>`. */
  adjacent(index) {
    const a = this.tokens[index],
      b = this.tokens[index + 1];
    return !!b && a.end === b.start;
  }
  /** The operator text at the cursor with `>`-family operators assembled from adjacent tokens: { text, count }. */
  operatorAt(index = this.i) {
    const kind = this.kindAt(index);
    if (kind === '>')
      for (const [parts, text] of greaterThanMerges)
        if (
          parts.every((part, k) => this.kindAt(index + k) === part && (k === 0 || this.adjacent(index + k - 1))) &&
          index + parts.length <= this.tokens.length
        )
          return { text, count: parts.length };
    return { text: kind, count: 1 };
  }
  /** Consumes `count` adjacent tokens as one operator token. */
  takeOperator({ text, count }) {
    if (count === 1) return this.take();
    const first = this.tokens[this.i],
      last = this.tokens[this.i + count - 1];
    this.i += count;
    return this.green(first, punctuationKinds[text], text, last.trailingTrivia);
  }
  /** Creates a green node; arrays become lists (null when empty) and `undefined` children become null. */
  n(kind, ...children) {
    this.nodeCount++;
    for (let k = 0; k < children.length; k++) {
      const child = children[k];
      if (Array.isArray(child)) children[k] = this.cache.list(child);
      else if (child === undefined) children[k] = null;
    }
    return this.cache.node(kind, children);
  }
  /** Checkpoint for speculative parsing; reset() discards tokens, diagnostics and feature uses recorded since. */
  mark() {
    return [this.i, this.diagnostics.length, this.features.length, this.skippedTokens, this.depth, this.skippedTokens.length, this.budgetExhausted];
  }
  // The pending skipped-token list only grows or is replaced, so restoring it is the old array cut back to its old length.
  reset(mark) {
    this.i = mark[0];
    this.diagnostics.length = mark[1];
    this.features.length = mark[2];
    this.skippedTokens = mark[3];
    this.skippedTokens.length = mark[5];
    this.depth = mark[4];
    this.budgetExhausted = mark[6];
  }
  guardProgress(before) {
    if (before === this.i && !this.at('eof')) {
      this.error(this.current, 'CS1525', `Unexpected token '${this.current.text}'`);
      this.skip();
    }
  }
}
Object.assign(Parser.prototype, recoveryMethods, blenderMethods, budgetMethods);

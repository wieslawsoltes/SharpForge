import { diagnostic, BoundedCache } from '@sharpforge/text';
import { keywords, reservedKeywordKinds } from './keywords.js';
import { punctuationKinds, scanOperator } from './operators.js';
import { scanNumber } from './numbers.js';
import { scanReal } from './reals.js';
import { scanString } from './strings.js';
import { scanRawString } from './raw-strings.js';
import { utf8SuffixLength, encodeUtf8 } from './utf8-suffix.js';
import { scanIdentifier, startsIdentifier } from './identifiers.js';
import { scanTrivia } from './trivia.js';
import { DirectiveState, unterminatedDirectives } from '../directives/conditional.js';
import { scanInterpolated } from '../interpolation.js';
import { legacyGreenToken, ownText } from '../green.js';
const nestingLimit = 200,
  empty = Object.freeze([]),
  fixedTokens = new WeakMap();
// Reserved syntax kinds are immutable metadata; keyword membership remains the public, live Set.
const reservedTokenKinds = new Map(Object.entries(reservedKeywordKinds));
/** Per-cache tables for keyword and punctuation tokens with no leading trivia or one leading space, keyed by the (pre-hashed) kind. */
const fixedFor = cache => {
  let tables = fixedTokens.get(cache);
  if (!tables) fixedTokens.set(cache, (tables = [new Map(), new Map()]));
  return tables;
};
/** Character scanner producing the flat token stream. Trivia is attached to tokens with Roslyn's leading/trailing rules. */
export class Scanner {
  constructor(source, cache = new BoundedCache(), options = {}) {
    this.source = source;
    this.text = source.text;
    this.cache = cache;
    this.options = options;
    this.i = 0;
    this.diagnostics = [];
    this.profile = [];
    this.features = [];
    this.directives = [];
    this.checkpoints = [];
    this.lastSnapshot = null;
    this.reused = 0;
    this.state = new DirectiveState(options.preprocessorSymbols ?? []);
    // Callbacks handed to the literal scanners; created once so that scanning a token allocates no closure.
    this.report = (at, length, code, message) => this.error(at, length, code, message);
    this.scanHole = (offset, stops) => this.hole(offset, stops);
  }
  error(start, length, code, message, severity) {
    this.diagnostics.push(diagnostic(this.source, start, length, code, message, severity));
  }
  feature(id, start, end) {
    this.features.push({ id, start, end });
  }
  /** Scans one token at the current offset (trivia already consumed). */
  token() {
    const text = this.text,
      start = this.i,
      ch = text[start];
    const raw = { kind: 'eof', start, end: start, value: undefined, literal: null, syntaxKind: 'EndOfFileToken' };
    if (start >= text.length) return raw;
    if ((ch === '$' && /^\$+@?"/.test(text.slice(start, start + 64))) || (ch === '@' && text.startsWith('@$"', start))) this.interpolatedToken(raw);
    else if (ch === '"' && text.startsWith('"""', start)) this.rawStringToken(raw);
    else if (ch === '"' || ch === "'" || (ch === '@' && text[start + 1] === '"')) this.stringToken(raw);
    else if ((ch >= '0' && ch <= '9') || (ch === '.' && text[start + 1] >= '0' && text[start + 1] <= '9')) this.numberToken(raw, ch === '.');
    else if (startsIdentifier(text, start)) this.identifierToken(raw);
    else this.operatorToken(raw);
    if (raw.syntaxKind.endsWith('StringLiteralToken')) this.utf8Suffix(raw);
    this.i = Math.min(this.i, text.length);
    raw.end = this.i;
    return raw;
  }
  interpolatedToken(raw) {
    const start = raw.start,
      scan = scanInterpolated(this.text, start, this.report, this.scanHole);
    raw.kind = 'interpolated';
    raw.syntaxKind = 'InterpolatedStringToken';
    raw.value = scan.parts;
    raw.structure = scan.structure;
    this.i = scan.end;
    // A feature of an interpolated string covers the whole literal unless the scan gives it a span of its own.
    for (const feature of scan.structure.features)
      if (typeof feature === 'string') this.feature(feature, start, scan.end);
      else this.feature(feature.id, feature.start, feature.end);
  }
  rawStringToken(raw) {
    const scan = scanRawString(this.text, raw.start, this.report);
    this.i = scan.end;
    raw.kind = 'string';
    raw.syntaxKind = scan.multiline ? 'MultiLineRawStringLiteralToken' : 'SingleLineRawStringLiteralToken';
    raw.value = scan.value;
    raw.flags = { raw: true, multiline: scan.multiline };
    this.feature('RawStringLiterals', raw.start, scan.end);
  }
  stringToken(raw) {
    const scan = scanString(this.text, raw.start, this.report);
    this.i = scan.end;
    raw.kind = scan.kind;
    raw.syntaxKind = scan.kind === 'char' ? 'CharacterLiteralToken' : 'StringLiteralToken';
    raw.value = scan.value;
    if (scan.verbatim) raw.flags = { verbatim: true };
    for (const feature of scan.features) this.feature(feature.id, feature.start, feature.end);
  }
  numberToken(raw, real) {
    const start = raw.start,
      scan = real ? scanReal(this.text, start) : scanNumber(this.text, start);
    this.i = scan.end;
    raw.kind = scan.kind;
    raw.syntaxKind = 'NumericLiteralToken';
    raw.value = scan.value;
    raw.literal = Object.freeze({ ...scan.literal, number: scan.value });
    for (const e of scan.errors) this.error(start, scan.end - start, e.code, e.message, e.severity);
    for (const e of scan.profile) this.profile.push(diagnostic(this.source, start, scan.end - start, e.code, e.message));
    // Roslyn reports the features of a numeric literal with a zero-width span at its start.
    for (const id of scan.features) this.feature(id, start, start);
    if (!Number.isFinite(scan.value) && !scan.errors.length) this.error(start, scan.end - start, 'CS1013', 'Invalid numeric literal');
  }
  identifierToken(raw) {
    const scan = scanIdentifier(this.text, raw.start);
    const kind = !scan.verbatim && !scan.hasEscapes && keywords.has(scan.value) ? scan.value : 'identifier';
    this.i = scan.end;
    raw.value = ownText(scan.value);
    raw.kind = kind;
    raw.syntaxKind = kind === 'identifier' ? 'IdentifierToken' : reservedTokenKinds.get(kind) ?? 'IdentifierToken';
    if (scan.verbatim || scan.hasEscapes) raw.flags = { verbatim: scan.verbatim, escaped: scan.hasEscapes };
    else if (kind !== 'identifier') raw.fixed = true;
  }
  /** An operator or punctuation token, or a BadToken (CS1056) for a character that starts no token. */
  operatorToken(raw) {
    const text = this.text,
      start = raw.start,
      op = scanOperator(text, start);
    if (op) {
      raw.kind = op;
      raw.syntaxKind = punctuationKinds[op];
      raw.fixed = true;
      this.i = start + op.length;
      return;
    }
    const point = text.codePointAt(start);
    this.i = start + (point > 0xffff ? 2 : 1);
    this.error(start, this.i - start, 'CS1056', `Unexpected character '${text.slice(start, this.i)}'`);
    raw.kind = 'bad';
    raw.syntaxKind = 'BadToken';
  }
  /** The C# 11 `u8` suffix after a string literal: the token becomes a UTF-8 literal and carries its bytes. */
  utf8Suffix(raw) {
    const suffix = utf8SuffixLength(this.text, this.i);
    if (!suffix) return;
    this.i += suffix;
    const encoded = encodeUtf8(raw.value);
    raw.bytes = encoded.bytes;
    raw.flags = { ...raw.flags, utf8: true };
    raw.syntaxKind = 'Utf8' + raw.syntaxKind;
    this.feature('Utf8StringLiterals', raw.start, this.i);
    if (encoded.error) this.error(raw.start, this.i - raw.start, encoded.error.code, encoded.error.message);
  }
  /**
   * Lexes until `stop()` or EOF. With captureTrivia:false, raw leading/trailing fields are omitted and head/tail are empty.
   * Token values, offsets, directives and lexical diagnostics remain unchanged; run()/lex() retain lossless trivia by default.
   */
  sequence(stop, {captureTrivia = true} = {}) {
    const raws = [],
      first = scanTrivia(this, !!stop, captureTrivia),
      head = first.trailing;
    let pending = first.leading;
    for (;;) {
      if (stop && stop()) return { raws, tail: pending, head };
      const raw = this.token();
      if (captureTrivia) raw.leading = pending;
      raws.push(raw);
      if (raw.kind === 'eof') return { raws, tail: empty, head };
      if ((raws.length & 255) === 0 && this.options.cancellationToken) this.options.cancellationToken.throwIfCancellationRequested();
      if (!stop) this.state.seenToken = true;
      const trivia = scanTrivia(this, true, captureTrivia);
      if (captureTrivia) raw.trailing = trivia.trailing;
      pending = trivia.leading;
    }
  }
  /** Lexes one interpolation hole from `offset` up to a depth-zero character of `stops` (or end of file). */
  hole(offset, stops) {
    const text = this.text,
      options = this.options,
      depthBefore = this.holeDepth ?? 0;
    let depth = 0,
      limit = false;
    if (depthBefore >= 64) return { tokens: empty, tail: empty, head: empty, end: offset, limit: true };
    this.i = offset;
    this.options = { ...options, directives: false };
    this.holeDepth = depthBefore + 1;
    const stop = () => {
      const ch = text[this.i];
      if (this.i >= text.length) return true;
      if (depth === 0 && stops.includes(ch)) return true;
      if ('([{'.includes(ch)) {
        if (++depth > nestingLimit) {
          limit = true;
          return true;
        }
      } else if (')]}'.includes(ch) && depth > 0) depth--;
      return false;
    };
    const { raws, tail, head } = this.sequence(stop),
      end = this.i,
      first = raws[0] ? (raws[0].leading[0]?.start ?? raws[0].start) : (tail[0]?.start ?? end);
    this.options = options;
    this.holeDepth = depthBefore;
    return { tokens: this.finish(raws, first), tail: Object.freeze(tail), head: Object.freeze(head), end, limit };
  }
  /** Converts raw scan records into frozen tokens. `fullStart` is where the first token's preceding trivia begins. */
  finish(raws, fullStart) {
    const text = this.text,
      cache = this.cache,
      tokens = [],
      fixed = fixedFor(cache);
    for (const raw of raws) {
      const { kind, start, end, value } = raw,
        tokenText = raw.fixed ? kind : ownText(text.slice(start, end)),
        fullText = start === fullStart ? tokenText : ownText(text.slice(fullStart, end));
      // Interned by full text; the rare spelling shared by two kinds falls back to a kind-qualified key.
      const lead = start - fullStart,
        table = raw.fixed && (lead === 0 || (lead === 1 && text.charCodeAt(fullStart) === 32)) ? fixed[lead] : null;
      let green = table ? table.get(kind) : cache.map.get(fullText);
      if (table) {
        if (green !== undefined) this.reused++;
        else table.set(kind, (green = legacyGreenToken(kind, tokenText, lead ? ' ' : '', value)));
      } else if (green !== undefined && green.kind === kind) this.reused++;
      else if (green === undefined)
        green = cache.getOrAdd(fullText, () => legacyGreenToken(kind, tokenText, fullText.slice(0, start - fullStart), value));
      else {
        const key = kind + '\0' + fullText;
        green = cache.map.get(key);
        if (green !== undefined) this.reused++;
        else green = cache.getOrAdd(key, () => legacyGreenToken(kind, tokenText, fullText.slice(0, start - fullStart), value));
      }
      const flags = raw.flags,
        syntaxKind = raw.syntaxKind;
      const token = {
        kind,
        syntaxKind,
        value,
        text: tokenText,
        start,
        end,
        fullStart,
        green,
        leadingTrivia: Object.freeze(raw.leading ?? empty),
        trailingTrivia: Object.freeze(raw.trailing ?? empty)
      };
      if (raw.literal) token.literal = raw.literal;
      if (raw.structure) token.structure = raw.structure;
      if (raw.bytes) token.bytes = raw.bytes;
      if (flags) token.flags = Object.freeze(flags);
      tokens.push(Object.freeze(token));
      fullStart = end;
      if ((tokens.length & 255) === 0 && this.options.cancellationToken) this.options.cancellationToken.throwIfCancellationRequested();
    }
    return Object.freeze(tokens);
  }
  run() {
    const { raws } = this.sequence(null),
      end = this.text.length;
    for (const [code, message] of unterminatedDirectives(this.state)) this.error(end, 0, code, message);
    return this.finish(raws, 0);
  }
}
/**
 * Tokenises a SourceText. Options: `preprocessorSymbols` (defined symbols for #if), `script` (allow #r/#load),
 * `cancellationToken` (polled every 256 tokens; see cancellation.js),
 * `directives: false` (treat `#` as an unexpected character) and `profile: false` (omit the SharpForge back-end
 * profile diagnostics SF1003-SF1005 for literal types the current compiler cannot consume).
 * Returns { source, tokens, diagnostics, internedTokenHits, directives, features, lexicalDiagnostics, profileDiagnostics, symbols,
 * checkpoints } - `checkpoints` are the preprocessor states after each directive, used by incremental relexing.
 */
export function lex(source, cache = new BoundedCache(), options = {}) {
  const scanner = new Scanner(source, cache ?? new BoundedCache(), options ?? {}),
    tokens = scanner.run();
  const lexical = scanner.diagnostics,
    diagnostics = options?.profile === false ? [...lexical] : [...lexical, ...scanner.profile].sort((a, b) => a.start - b.start);
  return {
    source,
    tokens,
    diagnostics,
    internedTokenHits: scanner.reused,
    directives: Object.freeze(scanner.directives),
    features: scanner.features,
    lexicalDiagnostics: lexical,
    profileDiagnostics: scanner.profile,
    symbols: scanner.state.symbols,
    checkpoints: scanner.checkpoints
  };
}

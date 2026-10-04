import {SourceText, BoundedCache} from '@sharpforge/text';
import {lex, relexTokens, TokenList} from '@sharpforge/syntax';
import {lexicalContext} from '../operations.js';
import {HighlightBrackets} from '../highlight-brackets.js';
import {sourceChange, validateSourceChange} from '../source-change.js';
import {tokenRuns} from './token-runs.js';

function sourceValue(source) { return typeof source === 'string' ? new SourceText(source) : source; }

function changeEnvelope(changes, before, after) {
  if (!changes.length) return null;
  let start = Infinity;
  let end = 0;
  for (const change of changes) {
    start = Math.min(start, change.start);
    end = Math.max(end, change.end);
  }
  return {start, length: end - start, newLength: end - start + after.length - before.length};
}

function lexicalSnapshot(scan, tokens) {
  let materialized = null;
  return {...scan, get tokens() {
    return materialized ??= Array.isArray(scan.tokens) ? scan.tokens : Object.freeze(tokens.toArray());
  }};
}

/** Shared incremental token index for persistent editor models and immutable source snapshots. */
export class SyntaxHighlightIndex {
  constructor(source, {maxLexCharacters = 2_000_000, previous = null, change = null} = {}) {
    if (!Number.isSafeInteger(maxLexCharacters) || maxLexCharacters < 0) throw new RangeError('Invalid lexical character limit');
    this.maxLexCharacters = maxLexCharacters;
    this.cache = previous?.cache ?? new BoundedCache();
    this.source = sourceValue(source);
    this.scan = null;
    this.lexed = null;
    this.tokens = null;
    this.cachedPairs = null;
    this.cachedRuns = null;
    this.brackets = new HighlightBrackets(null);
    if (previous && previous.source.uri === this.source.uri) {
      change = validateSourceChange(previous.source.text, this.source.text,
        change ?? sourceChange(previous.source.text, this.source.text));
    }
    this.read(this.source, previous, change);
  }

  get lineCount() { return this.source.lineCount ?? this.source.lineStarts.length; }
  get tokenCount() { return this.tokens?.length ?? 0; }
  lineStart(line) { return this.source.offsetAt({line, character: 0}); }
  get pairs() { return this.cachedPairs ??= this.brackets.materialize(); }
  get runs() { return this.cachedRuns ??= this.ranges(0, this.source.length, Number.MAX_SAFE_INTEGER).runs; }

  /** Create another source index without changing this snapshot or any previously returned lexical result. */
  withSource(source, change = null) {
    source = sourceValue(source);
    if (source === this.source) {
      if (change) validateSourceChange(source.text, source.text, change);
      return this;
    }
    return new SyntaxHighlightIndex(source, {maxLexCharacters: this.maxLexCharacters, previous: this, change});
  }

  /** The model supplies original-coordinate edits, avoiding whole-text flattening on its input path. */
  update(source, event = []) {
    source = sourceValue(source);
    if (source === this.source) return;
    const changes = event.changes ?? event;
    const previous = {source: this.source, scan: this.scan, tokens: this.tokens, brackets: this.brackets};
    const change = changeEnvelope(changes, this.source, source);
    this.read(source, previous, change);
  }

  read(source, previous, change) {
    this.source = source;
    this.cachedPairs = null;
    this.cachedRuns = null;
    if (source.length > this.maxLexCharacters) {
      this.scan = null;
      this.lexed = null;
      this.tokens = null;
      this.brackets = new HighlightBrackets(null);
      this.metrics = {relexedLines: 0, relexedTokens: 0, resynced: false};
      return;
    }
    const incremental = previous?.scan && previous.source.uri === source.uri && change;
    this.scan = incremental ? relexTokens({...previous.scan, tokenList: previous.tokens}, source, change, this.cache) : lex(source, this.cache);
    this.tokens = TokenList.from(this.scan.tokens, {source, cache: this.cache, options: {}});
    this.lexed = lexicalSnapshot(this.scan, this.tokens);
    this.brackets = new HighlightBrackets(this.tokens, incremental ? previous.brackets : null, this.scan.window, change);
    const window = this.scan.window;
    this.metrics = window ? {
      relexedLines: source.positionAt(window.endPosition).line - source.positionAt(window.start).line + 1,
      relexedTokens: window.end - window.first, resynced: window.resynced
    } : {relexedLines: this.lineCount, relexedTokens: this.tokens.length, resynced: false};
  }

  ranges(start, end, maxRuns = 10000) {
    if (!this.tokens) return {runs: end > start ? [{start, end, kind: '', bracket: false}] : [], syntax: false};
    const runs = tokenRuns(this.tokens, {start, end, maxRuns});
    if (runs === null) return {runs: [{start, end, kind: '', bracket: false}], syntax: false};
    return {runs, syntax: true};
  }

  window({scrollTop = 0, height = 400, lineHeight = 22, padding = 14, overscan = 4, maxRuns = 10000} = {}) {
    const values = [scrollTop, height, lineHeight, padding, overscan, maxRuns];
    if (!values.every(Number.isFinite) || scrollTop < 0 || height < 0 || lineHeight <= 0 || overscan < 0 || overscan > 100) {
      throw new RangeError('Invalid highlight viewport');
    }
    if (!Number.isInteger(maxRuns) || maxRuns < 1) throw new RangeError('Invalid highlight token budget');
    const firstLine = Math.min(this.lineCount - 1, Math.max(0, Math.floor((scrollTop - padding) / lineHeight) - Math.floor(overscan)));
    const count = Math.min(2000, Math.ceil(height / lineHeight) + Math.ceil(overscan) * 2 + 2);
    const lastLine = Math.min(this.lineCount, firstLine + count);
    const start = this.lineStart(firstLine);
    const end = lastLine < this.lineCount ? this.lineStart(lastLine) : this.source.length;
    return {firstLine, lastLine, start, end, ...this.ranges(start, end, maxRuns), characters: end - start};
  }

  kindAt(offset) {
    if (!this.tokens) return '';
    return this.ranges(Math.max(0, offset), Math.min(this.source.length, offset + 1), 10).runs[0]?.kind ?? '';
  }

  contextAt(offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.source.length) throw new RangeError('Invalid insertion position');
    if (!this.tokens) return 'code';
    const index = this.tokens.indexAt(offset);
    const nearby = [];
    for (let next = Math.max(0, index - 1); next <= Math.min(this.tokens.length - 1, index + 1); next++) nearby.push(this.tokens.get(next));
    // The tokens already carry literal/trivia text; lexicalContext only needs the source length here.
    return lexicalContext(this.source, offset, nearby);
  }

  dispose() {
    this.tokens = null;
    this.scan = null;
    this.lexed = null;
    this.brackets = new HighlightBrackets(null);
    this.cachedRuns = null;
    this.cachedPairs = null;
    this.cache.clear();
  }
}

import {SourceText, BoundedCache} from '@sharpforge/text';
import {lex, relexTokens, TokenList} from '@sharpforge/syntax';
import {bracketPairs} from '../operations.js';
import {tokenRuns} from './token-runs.js';

/** Incremental compiler-token index. Scroll queries do not rebuild syntax or full-document DOM. */
export class SyntaxHighlightIndex {
  constructor(source, {maxLexCharacters = 2_000_000} = {}) {
    if (!Number.isSafeInteger(maxLexCharacters) || maxLexCharacters < 0) throw new RangeError('Invalid lexical character limit');
    this.source = typeof source === 'string' ? new SourceText(source) : source;
    this.maxLexCharacters = maxLexCharacters;
    this.cache = new BoundedCache();
    this.lexed = this.source.length <= maxLexCharacters ? lex(this.source, this.cache) : null;
    this.tokens = this.lexed ? TokenList.from(this.lexed.tokens, {source: this.source, cache: this.cache, options: {}}) : null;
    this.cachedPairs = null;
    this.cachedRuns = null;
    this.metrics = {relexedLines: this.lexed ? this.lineCount : 0, relexedTokens: this.tokens?.length ?? 0, resynced: false};
  }

  get lineCount() { return this.source.lineCount ?? this.source.lineStarts.length; }
  lineStart(line) { return this.source.offsetAt({line, character: 0}); }

  get pairs() {
    if (!this.cachedPairs) this.cachedPairs = bracketPairs(this.source.text, this.tokens ? this.tokens.toArray() : []);
    return this.cachedPairs;
  }

  get runs() {
    if (!this.cachedRuns) this.cachedRuns = this.ranges(0, this.source.length, Number.MAX_SAFE_INTEGER).runs;
    return this.cachedRuns;
  }

  update(source, event = []) {
    const previous = this.source;
    const changes = event.changes ?? event;
    this.source = source;
    this.cachedPairs = null;
    this.cachedRuns = null;
    if (source.length > this.maxLexCharacters) {
      this.lexed = null;
      this.tokens = null;
      this.metrics = {relexedLines: 0, relexedTokens: 0, resynced: false};
      return;
    }
    if (!this.lexed || !changes.length) {
      this.lexed = lex(source, this.cache);
      this.tokens = TokenList.from(this.lexed.tokens, {source, cache: this.cache, options: {}});
      this.metrics = {relexedLines: this.lineCount, relexedTokens: this.tokens.length, resynced: false};
      return;
    }
    const first = Math.min(...changes.map(change => change.start));
    const last = Math.max(...changes.map(change => change.end));
    const delta = source.length - previous.length;
    const change = {start: first, length: last - first, newLength: last - first + delta};
    this.lexed = relexTokens({...this.lexed, tokenList: this.tokens}, source, change, this.cache);
    this.tokens = this.lexed.tokens;
    const window = this.lexed.window;
    this.metrics = {
      relexedLines: source.positionAt(window.endPosition).line - source.positionAt(window.start).line + 1,
      relexedTokens: window.end - window.first,
      resynced: window.resynced
    };
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

  dispose() {
    this.tokens = null;
    this.lexed = null;
    this.cachedRuns = null;
    this.cachedPairs = null;
    this.cache.clear();
  }
}

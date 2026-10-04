import {SourceText, BoundedCache} from '@sharpforge/text';
import {lex, relexTokens, TokenList} from '@sharpforge/syntax';
import {bracketPairs, lexicalContext} from './operations.js';
import {HighlightBrackets} from './highlight-brackets.js';
import {highlightRange, highlightRuns} from './highlight-runs.js';
import {sourceChange, validateSourceChange} from './source-change.js';

/** Immutable source-backed syntax. Reuse token segments between revisions and materialize viewport runs on demand. */
export class SyntaxHighlightIndex {
  constructor(source, {maxLexCharacters = 2_000_000, previous = null, change = null} = {}) {
    this.source = source instanceof SourceText ? source : new SourceText(source);
    if (!Number.isSafeInteger(maxLexCharacters) || maxLexCharacters < 0) throw new RangeError('Invalid lexical character limit');
    this.maxLexCharacters = maxLexCharacters;
    this.cache = previous?.cache ?? new BoundedCache();
    this.scan = null;
    this.tokens = null;
    this.fullTokens = null;
    this.fullRuns = null;
    this.fullPairs = null;
    this.lexed = null;
    if (this.source.length <= maxLexCharacters) {
      if (previous?.scan && previous.source.uri === this.source.uri) {
        change = validateSourceChange(previous.source.text, this.source.text, change ?? sourceChange(previous.source.text, this.source.text));
        this.scan = relexTokens(previous.scan, this.source, change, this.cache);
      } else this.scan = lex(this.source, this.cache);
      this.tokens = TokenList.from(this.scan.tokens, {source: this.source, cache: this.cache, options: {}});
      const owner = this;
      this.lexed = {...this.scan, get tokens() { return owner.materializeTokens(); }};
    }
    this.brackets = new HighlightBrackets(this.tokens, previous?.brackets, this.scan?.window, change);
  }

  withSource(source, change = null) {
    if (source === this.source) {
      if (change) validateSourceChange(source.text, source.text, change);
      return this;
    }
    return new SyntaxHighlightIndex(source, {maxLexCharacters: this.maxLexCharacters, previous: this, change});
  }

  get tokenCount() { return this.tokens?.length ?? 0; }

  materializeTokens() {
    if (!this.tokens) return null;
    return this.fullTokens ??= Array.isArray(this.scan.tokens) ? this.scan.tokens : Object.freeze(this.tokens.toArray());
  }

  /** Compatibility snapshots remain available to explicit consumers, outside the normal paint path. */
  get pairs() { return this.fullPairs ??= this.lexed ? bracketPairs(this.source.text, this.materializeTokens()) : new Map(); }
  get runs() { return this.fullRuns ??= this.tokens ? highlightRuns(this.tokens, 0, this.source.length, this.pairs).runs : []; }

  contextAt(offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.source.length) throw new RangeError('Invalid insertion position');
    if (!this.tokens) return 'code';
    const index = this.tokens.indexAt(offset);
    const nearby = [];
    for (let next = Math.max(0, index - 1); next <= Math.min(this.tokens.length - 1, index + 1); next++) nearby.push(this.tokens.get(next));
    return lexicalContext(this.source.text, offset, nearby);
  }

  window(options = {}) {
    const {maxRuns, ...range} = highlightRange(this.source, options);
    return {...range, ...highlightRuns(this.tokens, range.start, range.end, this.brackets, maxRuns)};
  }
}

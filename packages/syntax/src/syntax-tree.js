import { SourceText, BoundedCache } from '@sharpforge/text';
import { lex } from './lexer/scanner.js';
import { parseCompilationUnit } from './parser.js';
import { createNode } from './red.js';
import { checkFeatures } from './feature-gate.js';
import { parseLanguageVersion, languageVersionDiagnostic } from './langversion.js';
import { createLineMap } from './directives/misc.js';
/**
 * An immutable parsed document: source text, parse options, the lossless tree and its diagnostics.
 * Options: languageVersion, preprocessorSymbols, script, fileBasedProgram and `cache` (a BoundedCache shared across trees
 * so green tokens and nodes are interned between versions of a document).
 */
export class SyntaxTree {
  #root = null; #lineMap = null;
  constructor(source, options, green, diagnostics, features, directives) { this.source = source; this.options = options; this.green = green; this.diagnostics = diagnostics; this.features = features; this.directives = directives; Object.freeze(this); }
  /** Parses text (a string or SourceText) into a new tree. */
  static parseText(text, options = {}) {
    const source = typeof text === 'string' ? new SourceText(text, options.uri ?? 'Program.cs') : text, cache = options.cache ?? new BoundedCache(65536);
    const lexed = lex(source, cache, { ...options, profile: false }), parsed = parseCompilationUnit(lexed, { cache }), diagnostics = [...parsed.diagnostics];
    if (options.languageVersion !== undefined) {
      const version = parseLanguageVersion(options.languageVersion);
      if (!version) { const invalid = languageVersionDiagnostic(options.languageVersion); diagnostics.push({ uri: source.uri, version: source.version, start: 0, length: 0, code: invalid.code, message: invalid.message, severity: 'error', range: { start: source.positionAt(0), end: source.positionAt(0) } }); }
      else diagnostics.push(...checkFeatures(source, parsed.features, version));
    }
    diagnostics.sort((a, b) => a.start - b.start);
    return new SyntaxTree(source, Object.freeze({ ...options, cache }), parsed.green, Object.freeze(diagnostics), Object.freeze(parsed.features), lexed.directives);
  }
  /** The red CompilationUnit, created on first use. */
  get root() { return this.#root ??= createNode(this.green, null, 0); }
  get length() { return this.source.length; }
  getDiagnostics() { return this.diagnostics; }
  toFullString() { return this.green.fullText; }
  /** Maps offsets through #line directives: lineMap.map(offset) gives { line, character, path, hidden }. */
  get lineMap() { return this.#lineMap ??= createLineMap(this.source, this.directives); }
  /**
   * Applies text changes ({ start, length, text }, in coordinates of this tree's text, non-overlapping) and parses the result.
   * An empty change list returns a tree sharing this tree's green root. Tokens and small nodes outside the edited
   * region are reused by identity through the shared green cache.
   */
  withChangedText(changes = []) {
    const edits = [...changes].filter(c => c.length || c.text).sort((a, b) => a.start - b.start); let text = this.source.text;
    if (!edits.length) return new SyntaxTree(this.source, this.options, this.green, this.diagnostics, this.features, this.directives);
    for (let i = edits.length - 1; i >= 0; i--) {
      const { start, length = 0, text: inserted = '' } = edits[i];
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > text.length || i > 0 && edits[i - 1].start + (edits[i - 1].length ?? 0) > start) throw new RangeError('Invalid text change');
      text = text.slice(0, start) + inserted + text.slice(start + length);
    }
    return SyntaxTree.parseText(new SourceText(text, this.source.uri, this.source.version + 1), this.options);
  }
  /** The minimal single text change that turns `oldTree`'s text into this tree's text (empty when the texts are equal). */
  getChanges(oldTree) {
    const before = oldTree.source.text, after = this.source.text; if (before === after) return [];
    let prefix = 0; const limit = Math.min(before.length, after.length);
    while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
    let suffix = 0; while (suffix < limit - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
    return [{ start: prefix, length: before.length - prefix - suffix, text: after.slice(prefix, after.length - suffix) }];
  }
}

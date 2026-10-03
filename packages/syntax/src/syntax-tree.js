import { SourceText, BoundedCache } from '@sharpforge/text';
import { lex } from './lexer/scanner.js';
import { parseCompilationUnit } from './parser.js';
import { createNode } from './red.js';
import { checkFeatures } from './feature-gate.js';
import { parseLanguageVersion, languageVersionDiagnostic } from './langversion.js';
import { createLineMap } from './directives/misc.js';
import { relexTokens } from './incremental/relex.js';
import { Blender } from './incremental/blender.js';
import { parseDocumentationComment, documentationCommentKinds } from './lexer/doc-comments.js';
import { diagnostic } from '@sharpforge/text';
/** XML documentation warnings (CS1570, CS1584) for every documentation comment in the token stream. */
export function documentationDiagnostics(source, tokens) {
  const out = [];
  for (const token of tokens) for (const piece of token.leadingTrivia) if (documentationCommentKinds.has(piece.kind))
    for (const d of parseDocumentationComment(source.text.slice(piece.start, piece.end), piece.kind).diagnostics) out.push(diagnostic(source, piece.start + d.start, d.end - d.start, d.code, d.message, 'warning'));
  return out;
}
/**
 * An immutable parsed document: source text, parse options, the lossless tree and its diagnostics.
 * Options: languageVersion, preprocessorSymbols, script, fileBasedProgram, documentationMode ('parse' by default;
 * 'diagnose' also reports malformed XML documentation comments as CS1570 / CS1584 warnings) and `cache` (a BoundedCache shared across trees
 * so green tokens and nodes are interned between versions of a document).
 */
export class SyntaxTree {
  #root = null; #lineMap = null; #state = null;
  constructor(source, options, green, diagnostics, features, directives, state = null) { this.source = source; this.options = options; this.green = green; this.diagnostics = diagnostics; this.features = features; this.directives = directives; this.#state = state; Object.freeze(this); }
  /** Parses text (a string or SourceText) into a new tree. */
  static parseText(text, options = {}) {
    const source = typeof text === 'string' ? new SourceText(text, options.uri ?? 'Program.cs') : text;
    return SyntaxTree.#build(source, Object.isFrozen(options) && options.cache ? options : Object.freeze({ ...options, cache: options.cache ?? new BoundedCache(65536) }), null, null);
  }
  /** Lexes and parses `source`; with `previous` (a tree and the change leading to `source`) only the changed window is rescanned and old nodes are blended in. */
  static #build(source, options, previous, change) {
    const cache = options.cache, lexOptions = { ...options, profile: false }; let lexed, blend = null;
    if (previous) {
      lexed = relexTokens(previous.lexed, source, change, cache, lexOptions);
      blend = new Blender({ root: previous.tree.root, diagnostics: previous.parserDiagnostics, features: previous.parserFeatures, tokens: lexed.tokens, start: lexed.window.start, end: lexed.window.resynced ? lexed.window.endPosition : source.length + 1, delta: lexed.window.delta });
    } else lexed = lex(source, cache, lexOptions);
    // Small documents get a real token array (shifting every token is cheap); large ones a lazy view that shifts only the tokens the parser reads.
    const parsed = parseCompilationUnit(previous ? { ...lexed, tokens: lexed.tokens.length < 16384 && !options.lazyTokens ? lexed.tokens.toArray() : lexed.tokens.asArray() } : lexed, { cache, blend }), diagnostics = [...parsed.diagnostics];
    const byStart = (a, b) => a.start - b.start, state = { lexed, parserDiagnostics: parsed.diagnostics.slice(lexed.lexicalDiagnostics.length).sort(byStart), parserFeatures: parsed.features.slice(lexed.features.length).sort(byStart), reusedNodes: parsed.reusedNodes };
    if (options.languageVersion !== undefined) {
      const version = parseLanguageVersion(options.languageVersion);
      if (!version) { const invalid = languageVersionDiagnostic(options.languageVersion); diagnostics.push({ uri: source.uri, version: source.version, start: 0, length: 0, code: invalid.code, message: invalid.message, severity: 'error', range: { start: source.positionAt(0), end: source.positionAt(0) } }); }
      else diagnostics.push(...checkFeatures(source, parsed.features, version));
    }
    if (options.documentationMode === 'diagnose') diagnostics.push(...documentationDiagnostics(source, Array.isArray(lexed.tokens) ? lexed.tokens : lexed.tokens.toArray()));
    diagnostics.sort(byStart);
    return new SyntaxTree(source, options, parsed.green, Object.freeze(diagnostics), Object.freeze(parsed.features), lexed.directives, state);
  }
  /** How many old nodes the blender reused to build this tree (0 for a full parse). */
  get reusedNodeCount() { return this.#state?.reusedNodes ?? 0; }
  /** The red CompilationUnit, created on first use. */
  get root() { return this.#root ??= createNode(this.green, null, 0); }
  get length() { return this.source.length; }
  getDiagnostics() { return this.diagnostics; }
  toFullString() { return this.green.fullText; }
  /** Maps offsets through #line directives: lineMap.map(offset) gives { line, character, path, hidden }. */
  get lineMap() { return this.#lineMap ??= createLineMap(this.source, this.directives); }
  /**
   * Applies text changes ({ start, length, text }, in coordinates of this tree's text, non-overlapping) and parses the result
   * incrementally: only a window of tokens around the changes is rescanned and members and statements outside it are
   * reused from this tree by identity. An empty change list returns a tree sharing this tree's green root.
   * `options.incremental: false` forces a full parse.
   */
  withChangedText(changes = []) {
    const edits = [...changes].filter(c => c.length || c.text).sort((a, b) => a.start - b.start); let text = this.source.text;
    if (!edits.length) return new SyntaxTree(this.source, this.options, this.green, this.diagnostics, this.features, this.directives, this.#state);
    let inserted = '', cursor = edits[0].start;
    for (let i = edits.length - 1; i >= 0; i--) {
      const { start, length = 0, text: inserted = '' } = edits[i];
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > text.length || i > 0 && edits[i - 1].start + (edits[i - 1].length ?? 0) > start) throw new RangeError('Invalid text change');
    }
    // The changes are merged into one replacement spanning from the first to the last of them.
    for (const edit of edits) { inserted += text.slice(cursor, edit.start) + (edit.text ?? ''); cursor = edit.start + (edit.length ?? 0); }
    const start = edits[0].start, source = this.source.withChange(start, cursor - start, inserted), state = this.#state;
    if (!state || this.options.incremental === false || state.lexed.lexicalDiagnostics.length + state.parserDiagnostics.length >= 150) return SyntaxTree.#build(source, this.options, null, null);
    return SyntaxTree.#build(source, this.options, { tree: this, ...state }, { start, length: cursor - start, newLength: inserted.length });
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

/**
 * Interpolated strings: a scanned interpolated-string token is expanded into an InterpolatedStringExpression with text
 * parts and interpolations. Each hole was lexed into its own token window and is parsed by a nested parser that shares
 * the green cache, nesting depth and async context of this one.
 */
const noTrivia = Object.freeze([]);
function startTokenKind(structure) {
  if (!structure.raw) return structure.verbatim ? 'InterpolatedVerbatimStringStartToken' : 'InterpolatedStringStartToken';
  return structure.multiline ? 'InterpolatedMultiLineRawStringStartToken' : 'InterpolatedSingleLineRawStringStartToken';
}
export const interpolatedStringMethods = {
  /** Expands a scanned interpolated-string token into InterpolatedStringExpression, parsing each hole with a nested parser. */
  interpolatedString() {
    const token = this.current,
      structure = token.structure,
      text = this.source.text,
      cache = this.cache;
    this.i++;
    this.feature('InterpolatedStrings', token);
    const startText = text.slice(structure.start, structure.startEnd),
      start = cache.token(startTokenKind(structure), startText, undefined, this.leadingWithSkipped(token.leadingTrivia)),
      contents = [];
    for (const segment of structure.segments) {
      if (segment.type !== 'text') contents.push(this.interpolation(segment));
      else {
        const content = cache.token('InterpolatedStringTextToken', text.slice(segment.start, segment.end), segment.value);
        contents.push(this.n('InterpolatedStringText', content));
      }
    }
    const trailing = this.trivia(token.trailingTrivia),
      endKind = structure.raw ? 'InterpolatedRawStringEndToken' : 'InterpolatedStringEndToken';
    const end = structure.closed
      ? cache.token(endKind, text.slice(structure.endStart, structure.end), undefined, noTrivia, trailing)
      : new start.constructor(endKind, '', undefined, noTrivia, trailing, 1);
    return this.n('InterpolatedStringExpression', start, contents, end);
  },
  /** One hole: `{expression[, alignment][: format]}`. Trivia before each terminator becomes leading trivia of that terminator. */
  interpolation(segment) {
    const text = this.source.text,
      cache = this.cache,
      open = cache.token('OpenBraceToken', text.slice(segment.open.start, segment.open.end), undefined, noTrivia, this.trivia(segment.head));
    let [expression, pending] = this.interpolationHole(segment.tokens, segment.tail, segment.exprEnd),
      alignment = null,
      format = null;
    if (segment.comma >= 0) {
      const comma = cache.token('CommaToken', ',', undefined, pending, this.trivia(segment.alignHead));
      let value;
      [value, pending] = this.interpolationHole(segment.alignTokens, segment.alignTail, segment.alignEnd);
      alignment = this.n('InterpolationAlignmentClause', comma, value);
    }
    if (segment.colon >= 0) {
      const colon = cache.token('ColonToken', ':', undefined, pending),
        formatText = text.slice(segment.formatStart, segment.formatEnd);
      format = this.n('InterpolationFormatClause', colon, cache.token('InterpolatedStringTextToken', formatText, segment.formatValue));
      pending = noTrivia;
    }
    const close = segment.close
      ? cache.token('CloseBraceToken', text.slice(segment.close.start, segment.close.end), undefined, pending)
      : cache.missing('CloseBraceToken', pending);
    return this.n('Interpolation', open, expression, alignment, format, close);
  },
  /**
   * Parses the tokens of one hole (or alignment) with a nested parser whose window ends at offset `end`. Returns
   * [expression, trivia], the trivia being what stood before the terminator (`tail`) plus any skipped tokens.
   */
  interpolationHole(tokens, tail, end) {
    const eof = Object.freeze({
      kind: 'eof',
      syntaxKind: 'EndOfFileToken',
      text: '',
      value: undefined,
      start: end,
      end,
      fullStart: end,
      leadingTrivia: tail,
      trailingTrivia: noTrivia
    });
    const child = new this.constructor(
      { source: this.source, tokens: [...tokens, eof], diagnostics: [], features: [] },
      { greenCache: this.cache, inAsync: this.inAsync, languageVersion: this.languageVersion === 15 ? undefined : this.languageVersion }
    );
    child.depth = this.depth;
    child.fieldKeyword = this.fieldKeyword;
    const expression = child.expression();
    if (!child.at('eof')) {
      child.error(child.current, 'CS1003', 'Unexpected trailing interpolation input');
      child.skipRest();
    }
    for (const d of child.diagnostics) if (this.diagnostics.length < 200) this.diagnostics.push(d);
    this.features.push(...child.features);
    this.nodeCount += child.nodeCount;
    return [expression, child.leadingWithSkipped(tail)];
  }
};

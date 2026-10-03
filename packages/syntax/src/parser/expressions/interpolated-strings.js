/**
 * Interpolated strings: a scanned interpolated-string token is expanded into an InterpolatedStringExpression with text
 * parts and interpolations. Each hole was lexed into its own token window and is parsed by a nested parser that shares
 * the green cache, nesting depth and async context of this one.
 */
export const interpolatedStringMethods = {
  /** Expands a scanned interpolated-string token into InterpolatedStringExpression, parsing each hole with a nested parser. */
  interpolatedString() {
    const token = this.current,
      s = token.structure,
      text = this.source.text,
      cache = this.cache,
      slice = (a, b) => text.slice(a, b);
    this.i++;
    const raw = s.raw,
      startKind = raw
        ? s.multiline
          ? 'InterpolatedMultiLineRawStringStartToken'
          : 'InterpolatedSingleLineRawStringStartToken'
        : s.verbatim
          ? 'InterpolatedVerbatimStringStartToken'
          : 'InterpolatedStringStartToken';
    this.feature('InterpolatedStrings', token);
    const start = cache.token(startKind, slice(s.start, s.startEnd), undefined, this.leadingWithSkipped(token.leadingTrivia)),
      contents = [];
    const sub = (tokens, tail, end) => {
      const eof = Object.freeze({
        kind: 'eof',
        syntaxKind: 'EndOfFileToken',
        text: '',
        value: undefined,
        start: end,
        end,
        fullStart: end,
        leadingTrivia: tail,
        trailingTrivia: Object.freeze([])
      });
      const child = new this.constructor(
        { source: this.source, tokens: [...tokens, eof], diagnostics: [], features: [] },
        { greenCache: cache, inAsync: this.inAsync, languageVersion: this.languageVersion === 15 ? undefined : this.languageVersion }
      );
      child.depth = this.depth;
      const expression = child.expression();
      if (!child.at('eof')) {
        child.error(child.current, 'CS1003', 'Unexpected trailing interpolation input');
        child.skipRest();
      }
      for (const d of child.diagnostics) if (this.diagnostics.length < 200) this.diagnostics.push(d);
      this.features.push(...child.features);
      this.nodeCount += child.nodeCount;
      return [expression, child.leadingWithSkipped(tail)];
    };
    for (const segment of s.segments) {
      if (segment.type === 'text') {
        contents.push(this.n('InterpolatedStringText', cache.token('InterpolatedStringTextToken', slice(segment.start, segment.end), segment.value)));
        continue;
      }
      const open = cache.token(
        'OpenBraceToken',
        slice(segment.open.start, segment.open.end),
        undefined,
        Object.freeze([]),
        this.trivia(segment.head)
      );
      let [expression, pending] = sub(segment.tokens, segment.tail, segment.exprEnd),
        alignment = null,
        format = null;
      if (segment.comma >= 0) {
        const comma = cache.token('CommaToken', ',', undefined, pending, this.trivia(segment.alignHead));
        let value;
        [value, pending] = sub(segment.alignTokens, segment.alignTail, segment.alignEnd);
        alignment = this.n('InterpolationAlignmentClause', comma, value);
      }
      if (segment.colon >= 0) {
        format = this.n(
          'InterpolationFormatClause',
          cache.token('ColonToken', ':', undefined, pending),
          cache.token('InterpolatedStringTextToken', slice(segment.formatStart, segment.formatEnd), segment.formatValue)
        );
        pending = Object.freeze([]);
      }
      const close = segment.close
        ? cache.token('CloseBraceToken', slice(segment.close.start, segment.close.end), undefined, pending)
        : cache.missing('CloseBraceToken', pending);
      contents.push(this.n('Interpolation', open, expression, alignment, format, close));
    }
    const trailing = this.trivia(token.trailingTrivia),
      endKind = raw ? 'InterpolatedRawStringEndToken' : 'InterpolatedStringEndToken';
    const end = s.closed
      ? cache.token(endKind, slice(s.endStart, s.end), undefined, Object.freeze([]), trailing)
      : new start.constructor(endKind, '', undefined, Object.freeze([]), trailing, 1);
    return this.n('InterpolatedStringExpression', start, contents, end);
  }
};

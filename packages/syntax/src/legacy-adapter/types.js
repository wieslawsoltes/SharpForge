/**
 * Base of the legacy AST adapter: node construction, profile diagnostics, modifiers, and types flattened to the strings
 * the current compiler binds (`System.Collections.Generic.List<int>`, `int[]`).
 */
const frameworkGeneric =
  /^(?:System\.(?:(?:Threading\.Tasks|Collections\.Generic|Numerics)\.)?)?(?:Task|Action|Func|List|Dictionary|HashSet|Queue|Stack|Vector)$/;
const supportedModifiers = new Set([
  'public',
  'private',
  'protected',
  'internal',
  'static',
  'readonly',
  'const',
  'sealed',
  'partial',
  'virtual',
  'override',
  'abstract',
  'async'
]);
export class LegacyTypeAdapter {
  /** `report(start, end, code, message)` receives profile diagnostics. */
  constructor(source, report) {
    this.source = source;
    this.uri = source.uri;
    this.report = report;
  }
  fail(red, code, message) {
    const span = red.span;
    this.report(span.start, span.end, code, message);
  }
  node(kind, red, props, end = red) {
    return { kind, start: red.spanStart, end: end.span.end, uri: this.uri, ...props };
  }
  /** A node that starts where its first converted operand starts (parentheses around operands are not part of legacy spans). */
  from(kind, first, red, props) {
    return { kind, start: first.start, end: red.span.end, uri: this.uri, ...props };
  }
  nameSpan(token) {
    const span = token.span;
    return { start: span.start, end: span.end };
  }
  unsupported(red) {
    return this.node(red.kind, red, {});
  }
  attributes(red) {
    for (const list of red.attributeLists ?? []) this.fail(list, 'SF1018', 'Attributes are not implemented in this profile');
  }
  modifiers(tokens, start = 0) {
    const result = [];
    for (const token of tokens) {
      const text = token.text;
      result.push(text);
      if (!supportedModifiers.has(text) || ['virtual', 'override', 'abstract'].includes(text))
        this.fail(token, 'SF1011', `Modifier '${text}' is not implemented in this profile`);
    }
    return result;
  }
  // ---- types ------------------------------------------------------------------------------------------------------
  /** Dotted name text without profile checks (namespace names, base types). */
  typeName(red) {
    switch (red.kind) {
      case 'IdentifierName':
        return red.identifier.valueText;
      case 'QualifiedName':
        return this.typeName(red.left) + '.' + this.typeName(red.right);
      case 'GenericName':
        return red.identifier.valueText + '<' + red.typeArgumentList.arguments.map(a => this.typeName(a)).join(', ') + '>';
      case 'PredefinedType':
        return red.keyword.text;
      default:
        return red.toString();
    }
  }
  /** The legacy string form of a type: `System.Collections.Generic.List<int>[]`. */
  type(red, prefix = '') {
    switch (red.kind) {
      case 'PredefinedType':
        return red.keyword.text;
      case 'IdentifierName':
        return red.identifier.isMissing ? 'error' : red.identifier.valueText;
      case 'QualifiedName': {
        const left = this.type(red.left);
        return left + '.' + this.type(red.right, left + '.');
      }
      case 'GenericName': {
        const name = red.identifier.valueText;
        if (!frameworkGeneric.test(prefix + name)) this.fail(red, 'SF1012', 'Only registered closed framework generic types are supported');
        return name + '<' + red.typeArgumentList.arguments.map(a => (a.kind === 'OmittedTypeArgument' ? '' : this.type(a))).join(', ') + '>';
      }
      case 'ArrayType': {
        let text = this.type(red.elementType);
        for (const rank of red.rankSpecifiers) {
          if (rank.sizes.length !== 1) this.fail(rank, 'SF1019', 'Multi-dimensional arrays are not implemented in this profile');
          text += '[]';
        }
        return text;
      }
      case 'NullableType':
        this.fail(red, 'SF1013', 'Nullable type annotations are not implemented');
        return this.type(red.elementType);
      default:
        this.fail(red, 'SF1019', `${red.kind} syntax is not implemented in this profile`);
        return 'error';
    }
  }
}

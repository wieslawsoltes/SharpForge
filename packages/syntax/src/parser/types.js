/**
 * Type syntax: PredefinedType, IdentifierName, QualifiedName, AliasQualifiedName, GenericName, ArrayType,
 * NullableType, PointerType, TupleType, RefType and FunctionPointerType nodes, plus the token scans used
 * to tell types from expressions without building nodes.
 */
const expressionStarts = new Set([
  'identifier',
  'integer',
  'double',
  'string',
  'char',
  'interpolated',
  '(',
  '!',
  '-',
  '+',
  '~',
  '++',
  '--',
  '&',
  '*',
  '^',
  '..',
  '[',
  'new',
  'this',
  'base',
  'typeof',
  'default',
  'checked',
  'unchecked',
  'sizeof',
  'delegate',
  'throw',
  'ref',
  'stackalloc',
  'true',
  'false',
  'null',
  'await',
  'async',
  'var',
  'get',
  'set',
  'partial',
  'static',
  '__arglist',
  '__makeref',
  '__reftype',
  '__refvalue'
]);
export const typeMethods = {
  canStartExpression(token = this.current) {
    return (
      expressionStarts.has(token.kind) ||
      (this.isPredefined(token) && token.kind !== 'void') ||
      (token.kind === 'unsafe' &&
        (token === this.current ? this.isUnsafeExpression(this.i) : token === this.tokens[this.i + 1] && this.isUnsafeExpression(this.i + 1)))
    );
  },
  /** Scans a (possibly alias-qualified, generic, dotted) name at `i`; returns the index after it or -1. `info.generic` reports type arguments. */
  scanName(i, info) {
    if (!this.isId(this.tokens[i])) return -1;
    i++;
    if (this.kindAt(i) === '::') {
      if (!this.isId(this.tokens[i + 1])) return -1;
      i += 2;
      if (info) info.must = info.alias = true;
    }
    for (;;) {
      if (this.kindAt(i) === '<') {
        const j = this.scanTypeArguments(i);
        if (j < 0) return i;
        i = j;
        if (info) info.generic = true;
      }
      if (this.kindAt(i) === '.' && this.isId(this.tokens[i + 1])) i += 2;
      else return i;
    }
  },
  /** Scans `<...>` at `i`; returns the index after the closing `>` or -1 when this is not a type-argument list. */
  scanTypeArguments(i) {
    i++;
    if (this.kindAt(i) === '>') return i + 1;
    if (this.kindAt(i) === ',') {
      while (this.kindAt(i) === ',') i++;
      return this.kindAt(i) === '>' ? i + 1 : -1;
    }
    for (let guard = 0; guard < 512; guard++) {
      i = this.scanType(i);
      if (i < 0) return -1;
      const kind = this.kindAt(i);
      if (kind === ',') {
        i++;
        continue;
      }
      return kind === '>' ? i + 1 : -1;
    }
    return -1;
  },
  scanTupleType(i) {
    i++;
    let count = 0;
    for (let guard = 0; guard < 512; guard++) {
      i = this.scanType(i);
      if (i < 0) return -1;
      if (this.isId(this.tokens[i])) i++;
      count++;
      const kind = this.kindAt(i);
      if (kind === ',') {
        i++;
        continue;
      }
      return kind === ')' && count >= 2 ? i + 1 : -1;
    }
    return -1;
  },
  /**
   * Scans a type at `i` without building nodes; returns the index after it or -1.
   * `info.must` is set when the tokens can only be a type (predefined, array, nullable, pointer, alias-qualified);
   * `info.alias` and `info.suffix` say whether that came from an `alias::` prefix or a `?`, `*` or `[]` suffix.
   * `mode` 'afterIs' applies the `T ? a : b` rule: `?` and `*` extend the type only when no expression can follow
   * (or, for `?`, when a rank specifier does: `int?[]`).
   */
  scanType(i, info, mode) {
    if (this.depthScan > 64) return -1;
    this.depthScan = (this.depthScan ?? 0) + 1;
    try {
      if (this.kindAt(i) === 'ref') {
        i++;
        if (this.kindAt(i) === 'readonly') i++;
      }
      const token = this.tokens[Math.min(i, this.tokens.length - 1)];
      if (this.isPredefined(token)) {
        i++;
        if (info) info.must = info.predefined = true;
      } else if (token.kind === '(') {
        i = this.scanTupleType(i);
        if (i < 0) return -1;
        if (info) info.tuple = true;
      } else if (token.kind === 'delegate' && this.kindAt(i + 1) === '*') {
        i += 2;
        while (this.kindAt(i) !== '<' && this.kindAt(i) !== 'eof' && this.kindAt(i) !== ';') i++;
        let depth = 0;
        do {
          const kind = this.kindAt(i++);
          depth += kind === '<' ? 1 : kind === '>' ? -1 : 0;
          if (kind === 'eof') return -1;
        } while (depth > 0);
        if (info) info.must = true;
      } else {
        i = this.scanName(i, info);
        if (i < 0) return -1;
      }
      for (;;) {
        const kind = this.kindAt(i);
        if (kind === '?' || kind === '*') {
          // `T?[]` is an array of nullable values even where an expression could follow: `[]` is no operand of `?:`.
          const nullableArray = kind === '?' && this.isRankSpecifier(i + 1);
          if (mode === 'afterIs' && !nullableArray && this.canStartExpression(this.tokens[i + 1] ?? this.tokens.at(-1))) break;
          i++;
          if (info) {
            info.must = info.suffix = true;
            if (kind === '?') info.nullable = true;
          }
          continue;
        }
        if (kind === '[') {
          let j = i + 1;
          while (this.kindAt(j) === ',') j++;
          if (this.kindAt(j) !== ']') break;
          i = j + 1;
          if (info) info.must = info.suffix = true;
          continue;
        }
        break;
      }
      return i;
    } finally {
      this.depthScan--;
    }
  },
  /** Parses a type. `mode`: undefined (declaration contexts), 'afterIs' (operand of is/as and patterns) or 'new' (array sizes allowed). */
  type(mode) {
    if (this.at('ref')) {
      const ref = this.take(),
        readonly = this.match('readonly');
      return this.n('RefType', ref, readonly, this.type(mode));
    }
    if (!this.enter()) {
      this.leave();
      return this.n('IdentifierName', this.cache.missing('IdentifierToken'));
    }
    let type;
    if (this.isPredefined()) type = this.n('PredefinedType', this.take());
    else if (this.at('(')) type = this.tupleType();
    else if (this.at('delegate') && this.peek().kind === '*') type = this.functionPointerType();
    else if (this.isId()) type = this.name(mode === undefined);
    else {
      this.error(this.errorAnchor(), 'CS1031', 'Type expected');
      type = this.n('IdentifierName', this.cache.missing('IdentifierToken'));
    }
    for (let first = true; ;) {
      if (
        this.at('?') &&
        (mode === 'afterIs'
          ? !this.canStartExpression(this.peek()) || this.isRankSpecifier(this.i + 1)
          : mode === 'new'
            ? ['(', '[', '{'].includes(this.peek().kind)
            : true)
      ) {
        this.feature('Nullable', this.current);
        type = this.n('NullableType', type, this.take());
        continue;
      }
      if (this.at('*') && (mode !== 'afterIs' || !this.canStartExpression(this.peek()))) {
        type = this.n('PointerType', type, this.take());
        continue;
      }
      if (this.at('[') && ((mode === 'new' && first) || this.isRankSpecifier(this.i))) {
        const ranks = [];
        while (this.at('[') && (mode === 'new' || this.isRankSpecifier(this.i))) {
          ranks.push(this.rankSpecifier(mode === 'new'));
          first = false;
        }
        type = this.n('ArrayType', type, ranks);
        continue;
      }
      break;
    }
    this.leave();
    return type;
  },
  isRankSpecifier(i) {
    i++;
    while (this.kindAt(i) === ',') i++;
    return this.kindAt(i) === ']';
  },
  rankSpecifier(allowSizes) {
    const open = this.take(),
      sizes = [],
      omitted = () => this.n('OmittedArraySizeExpression', this.cache.token('OmittedArraySizeExpressionToken', '', undefined));
    for (;;) {
      if (this.at(',') || this.at(']') || !allowSizes) sizes.push(omitted());
      else sizes.push(this.expression());
      if (this.at(',')) sizes.push(this.take());
      else break;
    }
    return this.n('ArrayRankSpecifier', open, sizes, this.expect(']'));
  },
  /**
   * A namespace or type name: identifiers joined by `.`, with an optional `alias::` prefix and type arguments.
   * `definite` is true where only a type can stand (declarations, attributes, usings): there a `<` always opens a
   * type-argument list, so `[Attr<int]` reports the missing `>`. Where an expression could stand instead (after
   * `is`, `as` and `new`) the list must scan as one.
   */
  name(definite = true) {
    const context = definite ? 'definite' : true;
    let left;
    if (this.peek().kind === '::' && this.isId()) {
      this.feature('GlobalNamespace', this.current);
      const alias = this.n('IdentifierName', this.atWord('global') ? this.takeWord('global') : this.id());
      left = this.n('AliasQualifiedName', alias, this.take(), this.simpleName(context));
    } else left = this.simpleName(context);
    while (this.at('.') && this.peek().kind !== '.') left = this.n('QualifiedName', left, this.take(), this.simpleName(context));
    return left;
  },
  /**
   * An identifier with optional type arguments. `context` is 'definite' (a `<` always opens type arguments), true (a
   * type where the list must scan as one) or false (an expression, where the spec lookahead decides).
   */
  simpleName(context) {
    const nameToken = this.current,
      identifier = this.id();
    if (!this.at('<') || !this.isTypeArgumentListAhead(context)) return this.n('IdentifierName', identifier);
    const open = this.i,
      typeArguments = this.typeArgumentList();
    if (context === false) this.unboundGenericName(nameToken, open);
    return this.n('GenericName', identifier, typeArguments);
  },
  isTypeArgumentListAhead(context) {
    if (context === 'definite') return true;
    return context ? this.scanTypeArguments(this.i) >= 0 : this.isGenericNameInExpression(this.i);
  },
  typeArgumentList() {
    this.feature('Generics', this.current);
    const open = this.take(),
      args = [],
      omitted = () => this.n('OmittedTypeArgument', this.cache.token('OmittedTypeArgumentToken', '', undefined));
    if (this.at('>') || this.at(',')) {
      args.push(omitted());
      while (this.at(',')) {
        args.push(this.take());
        args.push(omitted());
      }
    } else
      for (;;) {
        args.push(this.type());
        if (this.at(',')) args.push(this.take());
        else break;
      }
    return this.n('TypeArgumentList', open, args, this.expect('>'));
  },
  tupleType() {
    this.feature('Tuples', this.current);
    const open = this.take(),
      elements = [];
    while (!this.at(')') || elements.length) {
      const type = this.type();
      elements.push(this.n('TupleElement', type, this.isId() ? this.take() : null));
      if (this.at(',')) elements.push(this.take());
      else break;
    }
    // Roslyn completes a tuple type of fewer than two elements with missing ones and reports the last (CS8124).
    if (elements.length < 2) {
      if (!elements.length) elements.push(this.n('TupleElement', this.missingName(), null));
      elements.push(this.cache.missing('CommaToken'));
      this.error(this.current, 'CS8124', 'Tuple must contain at least two elements.');
      elements.push(this.n('TupleElement', this.missingName(), null));
    }
    return this.n('TupleType', open, elements, this.expect(')'));
  },
  functionPointerType() {
    this.feature('FunctionPointers', this.current);
    const keyword = this.take(),
      star = this.take();
    let convention = null;
    if (this.atWord('managed') || this.atWord('unmanaged')) {
      const word = this.takeWord(this.current.value);
      let list = null;
      if (this.at('[')) {
        const open = this.take(),
          names = [];
        while (!this.at(']') && !this.at('eof')) {
          names.push(this.n('FunctionPointerUnmanagedCallingConvention', this.id()));
          if (this.at(',')) names.push(this.take());
          else break;
        }
        list = this.n('FunctionPointerUnmanagedCallingConventionList', open, names, this.expect(']'));
      }
      convention = this.n('FunctionPointerCallingConvention', word, list);
    }
    const open = this.expect('<'),
      parameters = [];
    while (!this.at('>') && !this.at('eof')) {
      const before = this.i,
        modifiers = [];
      while (this.atAny(['ref', 'out', 'in', 'readonly'])) modifiers.push(this.take());
      parameters.push(this.n('FunctionPointerParameter', null, modifiers, this.type()));
      if (this.at(',')) parameters.push(this.take());
      else break;
      if (before === this.i) break;
    }
    return this.n('FunctionPointerType', keyword, star, convention, this.n('FunctionPointerParameterList', open, parameters, this.expect('>')));
  }
};

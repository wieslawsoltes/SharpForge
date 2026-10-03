/**
 * Converts the lossless red tree into the plain AST consumed by the current compiler, language service,
 * designer and refactoring packages: flat `members` / `statements`, namespaces folded into class names,
 * types as strings. Syntax the SharpForge back end cannot bind yet is either reported here with the profile
 * diagnostics (SF10xx) or passed through as a node of its Roslyn kind, which the compiler reports as not implemented.
 */
const frameworkGeneric = /^(?:System\.(?:(?:Threading\.Tasks|Collections\.Generic|Numerics)\.)?)?(?:Task|Action|Func|List|Dictionary|HashSet|Queue|Stack|Vector)$/;
const supportedModifiers = new Set(['public', 'private', 'protected', 'internal', 'static', 'readonly', 'const', 'sealed', 'partial', 'virtual', 'override', 'abstract', 'async']);
const prefixKinds = new Set(['UnaryPlusExpression', 'UnaryMinusExpression', 'BitwiseNotExpression', 'LogicalNotExpression', 'PreIncrementExpression', 'PreDecrementExpression']);
const binaryKinds = new Set(['AddExpression', 'SubtractExpression', 'MultiplyExpression', 'DivideExpression', 'ModuloExpression', 'LeftShiftExpression', 'RightShiftExpression', 'UnsignedRightShiftExpression', 'LogicalOrExpression', 'LogicalAndExpression', 'BitwiseOrExpression', 'BitwiseAndExpression', 'ExclusiveOrExpression', 'EqualsExpression', 'NotEqualsExpression', 'LessThanExpression', 'LessThanOrEqualExpression', 'GreaterThanExpression', 'GreaterThanOrEqualExpression', 'CoalesceExpression']);
const literalTypes = { TrueLiteralExpression: 'bool', FalseLiteralExpression: 'bool', NullLiteralExpression: 'null', CharacterLiteralExpression: 'char', StringLiteralExpression: 'string' };
export class LegacyAdapter {
  /** `report(start, end, code, message)` receives profile diagnostics. */
  constructor(source, report) { this.source = source; this.uri = source.uri; this.report = report; }
  fail(red, code, message) { const span = red.span; this.report(span.start, span.end, code, message); }
  node(kind, red, props, end = red) { return { kind, start: red.spanStart, end: end.span.end, uri: this.uri, ...props }; }
  /** A node that starts where its first converted operand starts (parentheses around operands are not part of legacy spans). */
  from(kind, first, red, props) { return { kind, start: first.start, end: red.span.end, uri: this.uri, ...props }; }
  nameSpan(token) { const span = token.span; return { start: span.start, end: span.end }; }
  unsupported(red) { return this.node(red.kind, red, {}); }
  attributes(red) { for (const list of red.attributeLists ?? []) this.fail(list, 'SF1018', 'Attributes are not implemented in this profile'); }
  modifiers(tokens, start = 0) {
    const result = [];
    for (const token of tokens) {
      const text = token.text; result.push(text);
      if (!supportedModifiers.has(text) || ['virtual', 'override', 'abstract'].includes(text)) this.fail(token, 'SF1011', `Modifier '${text}' is not implemented in this profile`);
    }
    return result;
  }
  // ---- compilation unit -------------------------------------------------------------------------------------------
  compilationUnit(root, tokens) {
    const members = [], statements = []; this.attributes(root);
    for (const extern of root.externs) this.fail(extern, 'SF1018', 'Extern aliases are not implemented in this profile');
    this.namespaceMembers(root.members, '', members, statements);
    return { kind: 'CompilationUnit', start: tokens[0].start, end: tokens[Math.max(0, tokens.length - 2)].end, uri: this.uri, members, statements };
  }
  namespaceMembers(list, namespace, members, statements) {
    for (const member of list) {
      switch (member.kind) {
        case 'NamespaceDeclaration': case 'FileScopedNamespaceDeclaration': {
          this.attributes(member); for (const extern of member.externs) this.fail(extern, 'SF1018', 'Extern aliases are not implemented in this profile');
          const name = this.typeName(member.name), full = namespace ? namespace + '.' + name : name;
          this.namespaceMembers(member.members, full, members, statements); break;
        }
        case 'ClassDeclaration': members.push(this.classDeclaration(member, namespace)); break;
        case 'GlobalStatement': {
          const statement = member.statement;
          if (statement.kind === 'LocalFunctionStatement') members.push(this.method(statement, null, statement.returnType, statement.identifier));
          else this.statementInto(statement, statements);
          break;
        }
        case 'MethodDeclaration': if (!namespace) { members.push(this.method(member, null, member.returnType, member.identifier)); break; }
        // falls through
        default: this.fail(member, 'SF1010', namespace ? 'Only classes and nested namespaces are supported here' : `${member.kind.replace(/Declaration$/, '')} declarations are not implemented in this profile; only classes are supported`);
      }
    }
  }
  classDeclaration(red, namespace) {
    this.attributes(red); const modifiers = this.modifiers(red.modifiers), interfaces = [], members = [], name = red.identifier.valueText;
    if (red.typeParameterList) this.fail(red.typeParameterList, 'SF1012', 'Generic type declarations are not implemented in this profile');
    if (red.parameterList) this.fail(red.parameterList, 'SF1018', 'Primary constructors are not implemented in this profile');
    for (const clause of red.constraintClauses) this.fail(clause, 'SF1012', 'Generic constraints are not implemented in this profile');
    for (const base of red.baseList?.types ?? []) {
      const type = base.kind === 'SimpleBaseType' ? this.typeName(base.type) : null;
      if (type !== 'IDisposable' && type !== 'System.IDisposable') this.fail(base, 'SF1014', 'Only the IDisposable interface is supported by this class profile');
      else if (interfaces.length) this.fail(base, 'CS0528', 'Duplicate IDisposable interface'); else interfaces.push('System.IDisposable');
    }
    if (!red.openBraceToken) this.fail(red, 'SF1018', 'Type declarations without a body are not implemented in this profile');
    for (const member of red.members) this.member(member, name, members);
    return this.node('Class', red, { name, namespace, nameSpan: this.nameSpan(red.identifier), modifiers, members, interfaces });
  }
  member(red, owner, out) {
    switch (red.kind) {
      case 'ClassDeclaration': this.fail(red, 'SF1015', 'Nested classes are not implemented'); return;
      case 'MethodDeclaration': if (red.explicitInterfaceSpecifier) break; out.push(this.method(red, owner, red.returnType, red.identifier)); return;
      case 'ConstructorDeclaration': if (red.initializer) this.fail(red.initializer, 'SF1018', 'Constructor initializers are not implemented in this profile'); out.push(this.method(red, owner, null, red.identifier)); return;
      case 'PropertyDeclaration': if (red.explicitInterfaceSpecifier) break; out.push(this.property(red, owner)); return;
      case 'FieldDeclaration': {
        this.attributes(red); const modifiers = this.modifiers(red.modifiers), type = this.type(red.declaration.type);
        for (const declarator of red.declaration.variables) {
          if (declarator.argumentList) this.fail(declarator.argumentList, 'SF1018', 'Fixed-size buffers are not implemented in this profile');
          out.push(this.node('Field', red, { name: declarator.identifier.valueText, nameSpan: this.nameSpan(declarator.identifier), type, initializer: declarator.initializer ? this.expression(declarator.initializer.value) : null, modifiers, owner }));
        }
        return;
      }
      case 'IncompleteMember': return;
    }
    this.fail(red, red.kind.endsWith('Declaration') && !/^(?:Method|Property)/.test(red.kind) && /^(?:Struct|Interface|Enum|Delegate|Record)/.test(red.kind) ? 'SF1015' : 'SF1018', `${red.kind.replace(/Declaration$/, '')} members are not implemented in this profile`);
  }
  parameters(list) {
    return list.parameters.map(p => {
      this.attributes(p);
      for (const modifier of p.modifiers) this.fail(modifier, 'SF1017', 'Parameter modifiers are not implemented');
      if (p.default) this.fail(p.default, 'SF1018', 'Optional parameters are not implemented in this profile');
      return this.node('Parameter', p, { name: p.identifier.valueText, type: p.type ? this.type(p.type) : 'error', nameSpan: this.nameSpan(p.identifier) }, p.identifier);
    });
  }
  /** A block body, or the synthesized block of an expression body: `=> e;` becomes `{ return e; }` (or an expression statement for void). */
  body(red, asReturn, owner = red) {
    if (red.body) return this.block(red.body);
    const arrow = red.expressionBody;
    if (!arrow) { this.fail(owner, 'SF1018', 'Members without a body are not implemented in this profile'); return { kind: 'Block', start: owner.span.end, end: owner.span.end, uri: this.uri, statements: [] }; }
    const expression = this.expression(arrow.expression), end = red.semicolonToken ?? arrow, range = { start: expression.start, end: end.span.end, uri: this.uri };
    return { kind: 'Block', ...range, statements: [{ kind: asReturn ? 'Return' : 'ExpressionStatement', ...range, expression }] };
  }
  method(red, owner, returnType, identifier) {
    this.attributes(red); const constructor = red.kind === 'ConstructorDeclaration', modifiers = this.modifiers(red.modifiers);
    if (red.typeParameterList) this.fail(red.typeParameterList, 'SF1012', 'Generic methods are not implemented in this profile');
    for (const clause of red.constraintClauses ?? []) this.fail(clause, 'SF1012', 'Generic constraints are not implemented in this profile');
    const type = constructor ? 'void' : this.type(returnType), parameters = this.parameters(red.parameterList);
    return this.node('Method', red, { name: constructor ? '.ctor' : identifier.valueText, nameSpan: this.nameSpan(identifier), returnType: type, parameters, body: this.body(red, type !== 'void'), modifiers, owner }, red.body ?? red.semicolonToken ?? red);
  }
  property(red, owner) {
    this.attributes(red); const modifiers = this.modifiers(red.modifiers), type = this.type(red.type), accessors = [];
    if (red.expressionBody) accessors.push(this.node('Accessor', red.identifier, { name: 'get', modifiers: [], body: this.body(red, true) }, red.semicolonToken ?? red.expressionBody));
    for (const accessor of red.accessorList?.accessors ?? []) {
      this.attributes(accessor); const name = accessor.keyword.text;
      if (name !== 'get' && name !== 'set') this.fail(accessor.keyword, 'CS1014', 'A get or set accessor is expected (init is not supported in this profile)');
      accessors.push(this.node('Accessor', accessor, { name, modifiers: this.modifiers(accessor.modifiers), body: accessor.body || accessor.expressionBody ? this.body(accessor, name === 'get') : null }));
    }
    return this.node('Property', red, { name: red.identifier.valueText, nameSpan: this.nameSpan(red.identifier), type, accessors, initializer: red.initializer ? this.expression(red.initializer.value) : null, modifiers, owner });
  }
  // ---- types ------------------------------------------------------------------------------------------------------
  /** Dotted name text without profile checks (namespace names, base types). */
  typeName(red) {
    switch (red.kind) {
      case 'IdentifierName': return red.identifier.valueText;
      case 'QualifiedName': return this.typeName(red.left) + '.' + this.typeName(red.right);
      case 'GenericName': return red.identifier.valueText + '<' + red.typeArgumentList.arguments.map(a => this.typeName(a)).join(', ') + '>';
      case 'PredefinedType': return red.keyword.text;
      default: return red.toString();
    }
  }
  /** The legacy string form of a type: `System.Collections.Generic.List<int>[]`. */
  type(red, prefix = '') {
    switch (red.kind) {
      case 'PredefinedType': return red.keyword.text;
      case 'IdentifierName': return red.identifier.isMissing ? 'error' : red.identifier.valueText;
      case 'QualifiedName': { const left = this.type(red.left); return left + '.' + this.type(red.right, left + '.'); }
      case 'GenericName': {
        const name = red.identifier.valueText;
        if (!frameworkGeneric.test(prefix + name)) this.fail(red, 'SF1012', 'Only registered closed framework generic types are supported');
        return name + '<' + red.typeArgumentList.arguments.map(a => a.kind === 'OmittedTypeArgument' ? '' : this.type(a)).join(', ') + '>';
      }
      case 'ArrayType': {
        let text = this.type(red.elementType);
        for (const rank of red.rankSpecifiers) { if (rank.sizes.length !== 1) this.fail(rank, 'SF1019', 'Multi-dimensional arrays are not implemented in this profile'); text += '[]'; }
        return text;
      }
      case 'NullableType': this.fail(red, 'SF1013', 'Nullable type annotations are not implemented'); return this.type(red.elementType);
      default: this.fail(red, 'SF1019', `${red.kind} syntax is not implemented in this profile`); return 'error';
    }
  }
  // ---- statements -------------------------------------------------------------------------------------------------
  block(red) { this.attributes(red); const statements = []; for (const s of red.statements) this.statementInto(s, statements); return this.node('Block', red, { statements }); }
  statementInto(red, out) { out.push(this.statement(red)); }
  local(declaration, start, end, isConst) {
    const type = this.type(declaration.type);
    const declarations = declaration.variables.map(v => {
      if (v.argumentList) this.fail(v.argumentList, 'SF1018', 'Array declarators are not implemented in this profile');
      return this.node('Variable', v.identifier, { name: v.identifier.valueText, nameSpan: this.nameSpan(v.identifier), type, initializer: v.initializer ? this.expression(v.initializer.value) : null, isConst }, v);
    });
    return this.node('Local', start, { declarations }, end);
  }
  statement(red) {
    this.attributes(red);
    switch (red.kind) {
      case 'Block': return this.block(red);
      case 'EmptyStatement': return this.node('Empty', red, {});
      case 'ExpressionStatement': return this.node('ExpressionStatement', red, { expression: this.expression(red.expression) });
      case 'LocalDeclarationStatement': {
        const modifiers = red.modifiers, isConst = modifiers.some(m => m.text === 'const');
        if (red.awaitKeyword || modifiers.some(m => m.text !== 'const')) break;
        if (red.usingKeyword) return this.node('UsingDeclaration', red, { resources: this.local(red.declaration, red.declaration, red, isConst) });
        return this.local(red.declaration, red, red, isConst);
      }
      case 'CheckedStatement': case 'UncheckedStatement': return this.node('OverflowContext', red, { checked: red.kind === 'CheckedStatement', body: this.block(red.block) });
      case 'LabeledStatement': return this.node('Labeled', red, { label: red.identifier.valueText, body: this.statement(red.statement) });
      case 'UsingStatement': if (red.awaitKeyword) break; return this.node('Using', red, { resources: red.declaration ? this.local(red.declaration, red.declaration, red.declaration, false) : this.expression(red.expression), body: this.statement(red.statement) });
      case 'IfStatement': return this.node('If', red, { condition: this.expression(red.condition), then: this.statement(red.statement), otherwise: red.else ? this.statement(red.else.statement) : null });
      case 'SwitchStatement': return this.node('Switch', red, { expression: this.expression(red.expression), sections: red.sections.map(section => this.node('SwitchSection', section, {
        labels: section.labels.map(label => label.kind === 'DefaultSwitchLabel' ? null : label.kind === 'CaseSwitchLabel' ? this.expression(label.value) : this.unsupported(label)),
        statements: section.statements.map(s => this.statement(s)) })) });
      case 'WhileStatement': return this.node('While', red, { condition: this.expression(red.condition), body: this.statement(red.statement) });
      case 'DoStatement': return this.node('Do', red, { condition: this.expression(red.condition), body: this.statement(red.statement) });
      case 'ForStatement': {
        const initializers = red.initializers, incrementors = red.incrementors;
        if (initializers.length > 1) this.fail(initializers[1], 'SF1018', 'Multiple for-loop initializers are not implemented in this profile');
        if (incrementors.length > 1) this.fail(incrementors[1], 'SF1018', 'Multiple for-loop iterators are not implemented in this profile');
        const init = red.declaration ? this.local(red.declaration, red.declaration, red.declaration, false) : initializers.length ? this.expression(initializers[0]) : null;
        return this.node('For', red, { init, condition: red.condition ? this.expression(red.condition) : null, increment: incrementors.length ? this.expression(incrementors[0]) : null, body: this.statement(red.statement) });
      }
      case 'ForEachStatement': if (red.awaitKeyword) break; return this.node('Foreach', red, { type: this.type(red.type), name: red.identifier.valueText, nameSpan: this.nameSpan(red.identifier), expression: this.expression(red.expression), body: this.statement(red.statement) });
      case 'ReturnStatement': return this.node('Return', red, { expression: red.expression ? this.expression(red.expression) : null });
      case 'BreakStatement': return this.node('Break', red, { label: red.label ? red.label.valueText : null });
      case 'ContinueStatement': return this.node('Continue', red, { label: red.label ? red.label.valueText : null });
      case 'ThrowStatement': return this.node('Throw', red, { expression: red.expression ? this.expression(red.expression) : null });
      case 'TryStatement': return this.node('Try', red, { body: this.block(red.block), catches: red.catches.map(clause => {
        if (clause.filter) this.fail(clause.filter, 'SF1018', 'Exception filters are not implemented in this profile');
        const id = clause.declaration?.identifier ?? null;
        return { type: clause.declaration ? this.type(clause.declaration.type) : 'Exception', name: id?.valueText, nameSpan: id ? this.nameSpan(id) : null, body: this.block(clause.block) };
      }), finallyBody: red.finally ? this.block(red.finally.block) : null });
    }
    return this.unsupported(red);
  }
  // ---- expressions ------------------------------------------------------------------------------------------------
  args(list, what = 'Named and by-reference arguments') {
    return list.arguments.map(a => { if (a.nameColon || a.refKindKeyword) this.fail(a, 'SF1017', `${what} are not implemented in this profile`); return this.expression(a.expression); });
  }
  name(token, start = token) { return this.node('Name', start, { name: token.valueText, escaped: token.text.startsWith('@'), nameSpan: this.nameSpan(token) }, token); }
  /** Rebuilds the flat conditional-access shape: `a?.b.c` is Member(ConditionalMember(a, b), c). */
  whenNotNull(red, receiver, start) {
    switch (red.kind) {
      case 'MemberBindingExpression': return this.from('ConditionalMember', start, red, { target: receiver, name: red.name.identifier.valueText, nameSpan: this.nameSpan(red.name.identifier) });
      case 'ElementBindingExpression': return this.from('ConditionalIndex', start, red, { target: receiver, index: this.args(red.argumentList)[0] ?? this.node('Error', red, {}) });
      case 'SimpleMemberAccessExpression': return this.from('Member', start, red, { target: this.whenNotNull(red.expression, receiver, start), name: red.name.identifier.valueText, nameSpan: this.nameSpan(red.name.identifier) });
      case 'InvocationExpression': return this.from('Call', start, red, { target: this.whenNotNull(red.expression, receiver, start), args: this.args(red.argumentList) });
      case 'ElementAccessExpression': return this.from('Index', start, red, { target: this.whenNotNull(red.expression, receiver, start), index: this.args(red.argumentList)[0] ?? this.node('Error', red, {}) });
      case 'PostIncrementExpression': case 'PostDecrementExpression': { const operand = this.whenNotNull(red.operand, receiver, start); return this.from('Unary', start, red, { operator: red.operatorToken.text, operand, postfix: true }); }
      case 'ConditionalAccessExpression': return this.whenNotNull(red.whenNotNull, this.whenNotNull(red.expression, receiver, start), start);
    }
    if (red.kind.endsWith('AssignmentExpression')) { const left = this.whenNotNull(red.left, receiver, start); return this.from('Assignment', start, red, { operator: red.operatorToken.text, left, right: this.expression(red.right) }); }
    return this.unsupported(red);
  }
  /** Converts an expression. Left-deep chains (long concatenations, fluent calls) nest without a parser limit, so the conversion has its own depth budget. */
  expression(red) {
    if ((this.depth = (this.depth ?? 0) + 1) > 800) { this.depth--; if (!this.tooDeep) { this.tooDeep = true; this.fail(red, 'SF1099', 'Expression is too long or complex to compile'); } return this.unsupported(red); }
    const result = this.expressionCore(red); this.depth--; return result;
  }
  expressionCore(red) {
    const kind = red.kind;
    if (binaryKinds.has(kind)) { const left = this.expression(red.left); return this.from('Binary', left, red, { operator: red.operatorToken.text, left, right: this.expression(red.right) }); }
    if (kind.endsWith('AssignmentExpression')) { const left = this.expression(red.left); return this.from('Assignment', left, red, { operator: red.operatorToken.text, left, right: this.expression(red.right) }); }
    if (prefixKinds.has(kind)) return this.node('Unary', red, { operator: red.operatorToken.text, operand: this.expression(red.operand), postfix: false });
    switch (kind) {
      case 'IdentifierName': return red.identifier.isMissing ? this.node('Error', red, {}) : this.name(red.identifier);
      case 'ThisExpression': case 'BaseExpression': return this.name(red.token);
      case 'PredefinedType': return this.name(red.keyword);
      case 'GenericName': return this.node('Name', red, { name: this.type(red), nameSpan: { start: red.spanStart, end: red.span.end } });
      case 'NumericLiteralExpression': { const literal = red.token.value; return this.node('Literal', red, { value: literal.number, type: ['float', 'double', 'decimal'].includes(literal.type) ? 'double' : 'int' }); }
      case 'TrueLiteralExpression': case 'FalseLiteralExpression': return this.node('Literal', red, { value: kind === 'TrueLiteralExpression', type: 'bool' });
      case 'NullLiteralExpression': return this.node('Literal', red, { value: null, type: 'null' });
      case 'StringLiteralExpression': case 'CharacterLiteralExpression': return this.node('Literal', red, { value: red.token.value, type: literalTypes[kind] });
      case 'ParenthesizedExpression': return this.expression(red.expression);
      case 'SimpleMemberAccessExpression': { const target = this.expression(red.expression); if (red.name.kind !== 'IdentifierName') break; return this.from('Member', target, red, { target, name: red.name.identifier.valueText, nameSpan: this.nameSpan(red.name.identifier) }); }
      case 'InvocationExpression': { const target = this.expression(red.expression); return this.from('Call', target, red, { target, args: this.args(red.argumentList) }); }
      case 'ElementAccessExpression': {
        const target = this.expression(red.expression), args = this.args(red.argumentList);
        if (args.length !== 1) this.fail(red.argumentList, 'SF1018', 'Element access requires exactly one index in this profile');
        return this.from('Index', target, red, { target, index: args[0] ?? this.node('Error', red.argumentList, {}) });
      }
      case 'PostIncrementExpression': case 'PostDecrementExpression': { const operand = this.expression(red.operand); return this.from('Unary', operand, red, { operator: red.operatorToken.text, operand, postfix: true }); }
      case 'ConditionalAccessExpression': { const receiver = this.expression(red.expression); return this.whenNotNull(red.whenNotNull, receiver, receiver); }
      case 'ConditionalExpression': { const condition = this.expression(red.condition); return this.from('Conditional', condition, red, { condition, whenTrue: this.expression(red.whenTrue), whenFalse: this.expression(red.whenFalse) }); }
      case 'SwitchExpression': { const governing = this.expression(red.governingExpression); return this.from('SwitchExpression', governing, red, { expression: governing, arms: red.arms.map(arm => {
        if (arm.whenClause) this.fail(arm.whenClause, 'SF1018', 'Switch expression guards are not implemented in this profile');
        const pattern = arm.pattern.kind === 'DiscardPattern' ? null : arm.pattern.kind === 'ConstantPattern' ? this.expression(arm.pattern.expression) : this.unsupported(arm.pattern);
        return this.node('SwitchArm', arm, { pattern, expression: this.expression(arm.expression) });
      }) }); }
      case 'CheckedExpression': case 'UncheckedExpression': return this.node(kind === 'CheckedExpression' ? 'Checked' : 'Unchecked', red, { expression: this.expression(red.expression) });
      case 'AwaitExpression': return this.node('Await', red, { expression: this.expression(red.expression) });
      case 'DefaultExpression': return this.node('Default', red, { type: this.type(red.type) });
      case 'CastExpression': return this.node('Cast', red, { type: this.type(red.type), expression: this.expression(red.expression) });
      case 'InterpolatedStringExpression': {
        if (red.stringStartToken.kind.includes('Raw')) break;
        const parts = [];
        for (const content of red.contents) {
          if (content.kind === 'InterpolatedStringText') { if (content.textToken.value) parts.push({ text: content.textToken.value.replaceAll('{{', '{').replaceAll('}}', '}') }); continue; }
          const alignment = content.alignmentClause, format = content.formatClause, stop = alignment ? alignment.commaToken : format ? format.colonToken : content.closeBraceToken, align = alignment ? Number(alignment.value.toFullString().trim()) : 0;
          parts.push({ expression: this.expression(content.expression), start: content.openBraceToken.span.end, end: stop.spanStart, alignment: Number.isInteger(align) ? align : 0, format: format ? format.formatStringToken.text : '' });
        }
        return this.node('InterpolatedString', red, { parts });
      }
      case 'CollectionExpression': {
        const elements = []; let args = null;
        for (const element of red.elements) {
          if (element.kind === 'WithElement') args = element.argumentList.arguments.map(a => { if (a.refKindKeyword) this.fail(a, 'SF1017', 'By-reference arguments are not implemented in this profile'); return { name: a.nameColon ? a.nameColon.name.identifier.valueText : null, expression: this.expression(a.expression) }; });
          else if (element.kind === 'SpreadElement') elements.push(this.node('SpreadElement', element, { expression: this.expression(element.expression) }));
          else elements.push(this.expression(element.expression));
        }
        return this.node('CollectionExpression', red, { elements, arguments: args });
      }
      case 'ImplicitObjectCreationExpression': case 'ObjectCreationExpression': {
        const type = kind === 'ObjectCreationExpression' ? this.type(red.type) : '<target>', args = red.argumentList ? this.args(red.argumentList) : [], initializers = [], collectionInitializers = [], initializer = red.initializer;
        for (const item of initializer?.expressions ?? []) {
          if (initializer.kind === 'ObjectInitializerExpression') {
            if (item.kind !== 'SimpleAssignmentExpression' || item.left.kind !== 'IdentifierName') { this.fail(item, 'SF1018', 'Indexer and nested object initializers are not implemented in this profile'); continue; }
            initializers.push(this.node('Initializer', item, { name: item.left.identifier.valueText, nameSpan: this.nameSpan(item.left.identifier), expression: this.expression(item.right) }));
          } else collectionInitializers.push(item.kind === 'ComplexElementInitializerExpression' ? item.expressions.map(e => this.expression(e)) : [this.expression(item)]);
        }
        return this.node('New', red, { type, args, initializers, collectionInitializers });
      }
      case 'ArrayCreationExpression': case 'ImplicitArrayCreationExpression': {
        const implicit = kind === 'ImplicitArrayCreationExpression', values = red.initializer ? red.initializer.expressions.map(e => this.expression(e)) : null; let length = null, sized = false, type = 'var[]';
        if (implicit) { if (red.commas.length) this.fail(red, 'SF1019', 'Multi-dimensional arrays are not implemented in this profile'); }
        else {
          const ranks = red.type.rankSpecifiers, sizes = ranks[0].sizes; type = this.type(red.type.elementType) + '[]';
          if (ranks.length !== 1 || sizes.length !== 1) this.fail(red.type, 'SF1019', 'Jagged and multi-dimensional array creation is not implemented in this profile');
          if (sizes[0].kind !== 'OmittedArraySizeExpression') { length = this.expression(sizes[0]); sized = true; }
        }
        return this.node('NewArray', red, { type, length, values: values ?? (sized || implicit ? null : []) });
      }
    }
    return this.unsupported(red);
  }
}
/** Converts a red CompilationUnit to the legacy root node. */
export function toLegacyTree(root, source, tokens, report) { return new LegacyAdapter(source, report).compilationUnit(root, tokens); }
/** Converts a red expression node to the legacy expression node. */
export function toLegacyExpression(expression, source, report) { return new LegacyAdapter(source, report).expression(expression); }

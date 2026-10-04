import { LegacyStatementAdapter } from './legacy-adapter/statements.js';
/**
 * Converts the lossless red tree into the plain AST consumed by the current compiler, language service,
 * designer and refactoring packages: flat `members` / `statements`, namespaces folded into class names,
 * types as strings. Syntax the SharpForge back end cannot bind yet is either reported here with the profile
 * diagnostics (SF10xx) or passed through as a node of its Roslyn kind, which the compiler reports as not implemented.
 */
export class LegacyAdapter extends LegacyStatementAdapter {
  // ---- compilation unit -------------------------------------------------------------------------------------------
  compilationUnit(root, tokens) {
    const members = [],
      statements = [];
    this.attributes(root);
    for (const extern of root.externs) this.fail(extern, 'SF1018', 'Extern aliases are not implemented in this profile');
    this.namespaceMembers(root.members, '', members, statements);
    return { kind: 'CompilationUnit', start: tokens[0].start, end: tokens[Math.max(0, tokens.length - 2)].end, uri: this.uri, members, statements };
  }
  namespaceMembers(list, namespace, members, statements) {
    for (const member of list) {
      switch (member.kind) {
        case 'NamespaceDeclaration':
        case 'FileScopedNamespaceDeclaration': {
          this.attributes(member);
          for (const extern of member.externs) this.fail(extern, 'SF1018', 'Extern aliases are not implemented in this profile');
          const name = this.typeName(member.name),
            full = namespace ? namespace + '.' + name : name;
          this.namespaceMembers(member.members, full, members, statements);
          break;
        }
        case 'ClassDeclaration':
          members.push(this.classDeclaration(member, namespace));
          break;
        case 'GlobalStatement': {
          const statement = member.statement;
          if (statement.kind === 'LocalFunctionStatement') members.push(this.method(statement, null, statement.returnType, statement.identifier));
          else this.statementInto(statement, statements);
          break;
        }
        case 'MethodDeclaration':
          if (!namespace) {
            members.push(this.method(member, null, member.returnType, member.identifier));
            break;
          }
        // falls through
        default:
          this.fail(
            member,
            'SF1010',
            namespace
              ? 'Only classes and nested namespaces are supported here'
              : `${member.kind.replace(/Declaration$/, '')} declarations are not implemented in this profile; only classes are supported`
          );
      }
    }
  }
  classDeclaration(red, namespace) {
    this.attributes(red);
    const modifiers = this.modifiers(red.modifiers),
      interfaces = [],
      members = [],
      name = red.identifier.valueText;
    if (red.typeParameterList) this.fail(red.typeParameterList, 'SF1012', 'Generic type declarations are not implemented in this profile');
    if (red.parameterList) this.fail(red.parameterList, 'SF1018', 'Primary constructors are not implemented in this profile');
    for (const clause of red.constraintClauses) this.fail(clause, 'SF1012', 'Generic constraints are not implemented in this profile');
    for (const base of red.baseList?.types ?? []) {
      const type = base.kind === 'SimpleBaseType' ? this.typeName(base.type) : null;
      if (type !== 'IDisposable' && type !== 'System.IDisposable')
        this.fail(base, 'SF1014', 'Only the IDisposable interface is supported by this class profile');
      else if (interfaces.length) this.fail(base, 'CS0528', 'Duplicate IDisposable interface');
      else interfaces.push('System.IDisposable');
    }
    if (!red.openBraceToken) this.fail(red, 'SF1018', 'Type declarations without a body are not implemented in this profile');
    for (const member of red.members) this.member(member, name, members);
    return this.node('Class', red, { name, namespace, nameSpan: this.nameSpan(red.identifier), modifiers, members, interfaces });
  }
  member(red, owner, out) {
    switch (red.kind) {
      case 'ClassDeclaration':
        this.fail(red, 'SF1015', 'Nested classes are not implemented');
        return;
      case 'MethodDeclaration':
        if (red.explicitInterfaceSpecifier) break;
        out.push(this.method(red, owner, red.returnType, red.identifier));
        return;
      case 'ConstructorDeclaration':
        if (red.initializer) this.fail(red.initializer, 'SF1018', 'Constructor initializers are not implemented in this profile');
        out.push(this.method(red, owner, null, red.identifier));
        return;
      case 'PropertyDeclaration':
        if (red.explicitInterfaceSpecifier) break;
        out.push(this.property(red, owner));
        return;
      case 'FieldDeclaration': {
        this.attributes(red);
        const modifiers = this.modifiers(red.modifiers),
          type = this.type(red.declaration.type);
        for (const declarator of red.declaration.variables) {
          if (declarator.argumentList) this.fail(declarator.argumentList, 'SF1018', 'Fixed-size buffers are not implemented in this profile');
          out.push(
            this.node('Field', red, {
              name: declarator.identifier.valueText,
              nameSpan: this.nameSpan(declarator.identifier),
              type,
              initializer: declarator.initializer ? this.expression(declarator.initializer.value) : null,
              modifiers,
              owner
            })
          );
        }
        return;
      }
      case 'IncompleteMember':
        return;
    }
    this.fail(
      red,
      red.kind.endsWith('Declaration') && !/^(?:Method|Property)/.test(red.kind) && /^(?:Struct|Interface|Enum|Delegate|Record)/.test(red.kind)
        ? 'SF1015'
        : 'SF1018',
      `${red.kind.replace(/Declaration$/, '')} members are not implemented in this profile`
    );
  }
  parameters(list) {
    return list.parameters.map(p => {
      this.attributes(p);
      for (const modifier of p.modifiers) this.fail(modifier, 'SF1017', 'Parameter modifiers are not implemented');
      if (p.default) this.fail(p.default, 'SF1018', 'Optional parameters are not implemented in this profile');
      return this.node(
        'Parameter',
        p,
        { name: p.identifier.valueText, type: p.type ? this.type(p.type) : 'error', nameSpan: this.nameSpan(p.identifier) },
        p.identifier
      );
    });
  }
  /** A block body, or the synthesized block of an expression body: `=> e;` becomes `{ return e; }` (or an expression statement for void). */
  body(red, asReturn, owner = red) {
    // Roslyn keeps both bodies for the binder to report (CS8057); this profile has one body per member.
    if (red.body && red.expressionBody) {
      this.fail(red.expressionBody, 'SF1018', 'Members with both a block body and an expression body are not implemented in this profile');
    }
    if (red.body) return this.block(red.body);
    const arrow = red.expressionBody;
    if (!arrow) {
      this.fail(owner, 'SF1018', 'Members without a body are not implemented in this profile');
      return { kind: 'Block', start: owner.span.end, end: owner.span.end, uri: this.uri, statements: [] };
    }
    const expression = this.expression(arrow.expression),
      end = red.semicolonToken ?? arrow,
      range = { start: expression.start, end: end.span.end, uri: this.uri };
    return { kind: 'Block', ...range, statements: [{ kind: asReturn ? 'Return' : 'ExpressionStatement', ...range, expression }] };
  }
  method(red, owner, returnType, identifier) {
    this.attributes(red);
    const constructor = red.kind === 'ConstructorDeclaration',
      modifiers = this.modifiers(red.modifiers);
    if (red.typeParameterList) this.fail(red.typeParameterList, 'SF1012', 'Generic methods are not implemented in this profile');
    for (const clause of red.constraintClauses ?? []) this.fail(clause, 'SF1012', 'Generic constraints are not implemented in this profile');
    const type = constructor ? 'void' : this.type(returnType),
      parameters = this.parameters(red.parameterList);
    return this.node(
      'Method',
      red,
      {
        name: constructor ? '.ctor' : identifier.valueText,
        nameSpan: this.nameSpan(identifier),
        returnType: type,
        parameters,
        body: this.body(red, type !== 'void'),
        modifiers,
        owner
      },
      red.body ?? red.semicolonToken ?? red
    );
  }
  property(red, owner) {
    this.attributes(red);
    const modifiers = this.modifiers(red.modifiers),
      type = this.type(red.type),
      accessors = [];
    if (red.expressionBody)
      accessors.push(
        this.node('Accessor', red.identifier, { name: 'get', modifiers: [], body: this.body(red, true) }, red.semicolonToken ?? red.expressionBody)
      );
    for (const accessor of red.accessorList?.accessors ?? []) {
      this.attributes(accessor);
      const name = accessor.keyword.text;
      if (name !== 'get' && name !== 'set')
        this.fail(accessor.keyword, 'CS1014', 'A get or set accessor is expected (init is not supported in this profile)');
      accessors.push(
        this.node('Accessor', accessor, {
          name,
          modifiers: this.modifiers(accessor.modifiers),
          body: accessor.body || accessor.expressionBody ? this.body(accessor, name === 'get') : null
        })
      );
    }
    return this.node('Property', red, {
      name: red.identifier.valueText,
      nameSpan: this.nameSpan(red.identifier),
      type,
      accessors,
      initializer: red.initializer ? this.expression(red.initializer.value) : null,
      modifiers,
      owner
    });
  }
}
/** Converts a red CompilationUnit to the legacy root node. */
export function toLegacyTree(root, source, tokens, report) {
  return new LegacyAdapter(source, report).compilationUnit(root, tokens);
}
/** Converts a red expression node to the legacy expression node. */
export function toLegacyExpression(expression, source, report) {
  return new LegacyAdapter(source, report).expression(expression);
}

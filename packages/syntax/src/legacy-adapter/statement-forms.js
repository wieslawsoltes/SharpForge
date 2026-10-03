/**
 * Legacy AST conversion of each statement kind, as a table from Roslyn node kind to a converter. A converter runs
 * with the adapter as `this` and receives the red node; it returns the legacy node, or null when the form has no
 * legacy counterpart (the adapter then reports it as not supported). Adding a form means adding an entry here.
 */
function overflowContext(red) {
  return this.node('OverflowContext', red, { checked: red.kind === 'CheckedStatement', body: this.block(red.block) });
}
function switchLabel(label) {
  if (label.kind === 'DefaultSwitchLabel') return null;
  return label.kind === 'CaseSwitchLabel' ? this.expression(label.value) : this.unsupported(label);
}
function switchSection(section) {
  return this.node('SwitchSection', section, {
    labels: section.labels.map(switchLabel, this),
    statements: section.statements.map(statement => this.statement(statement))
  });
}
function catchClause(clause) {
  const id = clause.declaration?.identifier ?? null;
  return {
    type: clause.declaration ? this.type(clause.declaration.type) : 'Exception',
    name: id?.valueText,
    nameSpan: id ? this.nameSpan(id) : null,
    filter: clause.filter ? this.expression(clause.filter.filterExpression) : null,
    body: this.block(clause.block)
  };
}
const jump = legacyKind =>
  function (red) {
    return this.node(legacyKind, red, { label: red.label ? red.label.valueText : null });
  };
const optionalExpression = legacyKind =>
  function (red) {
    return this.node(legacyKind, red, { expression: red.expression ? this.expression(red.expression) : null });
  };
const loop = legacyKind =>
  function (red) {
    return this.node(legacyKind, red, { condition: this.expression(red.condition), body: this.statement(red.statement) });
  };
export const statementForms = Object.freeze({
  Block(red) {
    return this.block(red);
  },
  EmptyStatement(red) {
    return this.node('Empty', red, {});
  },
  ExpressionStatement(red) {
    return this.node('ExpressionStatement', red, { expression: this.expression(red.expression) });
  },
  LocalDeclarationStatement(red) {
    const modifiers = red.modifiers,
      isConst = modifiers.some(m => m.text === 'const');
    if (red.awaitKeyword || modifiers.some(m => m.text !== 'const')) return null;
    if (red.usingKeyword) return this.node('UsingDeclaration', red, { resources: this.local(red.declaration, red.declaration, red, isConst) });
    return this.local(red.declaration, red, red, isConst);
  },
  CheckedStatement: overflowContext,
  UncheckedStatement: overflowContext,
  LabeledStatement(red) {
    return this.node('Labeled', red, { label: red.identifier.valueText, body: this.statement(red.statement) });
  },
  UsingStatement(red) {
    if (red.awaitKeyword) return null;
    const declaration = red.declaration;
    return this.node('Using', red, {
      resources: declaration ? this.local(declaration, declaration, declaration, false) : this.expression(red.expression),
      body: this.statement(red.statement)
    });
  },
  IfStatement(red) {
    return this.node('If', red, {
      condition: this.expression(red.condition),
      then: this.statement(red.statement),
      otherwise: red.else ? this.statement(red.else.statement) : null
    });
  },
  SwitchStatement(red) {
    return this.node('Switch', red, { expression: this.expression(red.expression), sections: red.sections.map(switchSection, this) });
  },
  WhileStatement: loop('While'),
  DoStatement: loop('Do'),
  ForStatement(red) {
    const initializers = red.initializers,
      incrementors = red.incrementors,
      declaration = red.declaration;
    if (initializers.length > 1) this.fail(initializers[1], 'SF1018', 'Multiple for-loop initializers are not implemented in this profile');
    if (incrementors.length > 1) this.fail(incrementors[1], 'SF1018', 'Multiple for-loop iterators are not implemented in this profile');
    const init = declaration ? this.local(declaration, declaration, declaration, false) : initializers.length ? this.expression(initializers[0]) : null;
    return this.node('For', red, {
      init,
      condition: red.condition ? this.expression(red.condition) : null,
      increment: incrementors.length ? this.expression(incrementors[0]) : null,
      body: this.statement(red.statement)
    });
  },
  ForEachStatement(red) {
    if (red.awaitKeyword) return null;
    return this.node('Foreach', red, {
      type: this.type(red.type),
      name: red.identifier.valueText,
      nameSpan: this.nameSpan(red.identifier),
      expression: this.expression(red.expression),
      body: this.statement(red.statement)
    });
  },
  ReturnStatement: optionalExpression('Return'),
  BreakStatement: jump('Break'),
  ContinueStatement: jump('Continue'),
  ThrowStatement: optionalExpression('Throw'),
  TryStatement(red) {
    return this.node('Try', red, {
      body: this.block(red.block),
      catches: red.catches.map(catchClause, this),
      finallyBody: red.finally ? this.block(red.finally.block) : null
    });
  }
});

import { LegacyExpressionAdapter } from './expressions.js';
/** Legacy AST adapter for statements: blocks, locals, control flow and the statement forms the back end cannot bind yet. */
export class LegacyStatementAdapter extends LegacyExpressionAdapter {
  // ---- statements -------------------------------------------------------------------------------------------------
  block(red) {
    this.attributes(red);
    const statements = [];
    for (const s of red.statements) this.statementInto(s, statements);
    return this.node('Block', red, { statements });
  }
  statementInto(red, out) {
    out.push(this.statement(red));
  }
  local(declaration, start, end, isConst) {
    const type = this.type(declaration.type);
    const declarations = declaration.variables.map(v => {
      if (v.argumentList) this.fail(v.argumentList, 'SF1018', 'Array declarators are not implemented in this profile');
      return this.node(
        'Variable',
        v.identifier,
        {
          name: v.identifier.valueText,
          nameSpan: this.nameSpan(v.identifier),
          type,
          initializer: v.initializer ? this.expression(v.initializer.value) : null,
          isConst
        },
        v
      );
    });
    return this.node('Local', start, { declarations }, end);
  }
  statement(red) {
    this.attributes(red);
    switch (red.kind) {
      case 'Block':
        return this.block(red);
      case 'EmptyStatement':
        return this.node('Empty', red, {});
      case 'ExpressionStatement':
        return this.node('ExpressionStatement', red, { expression: this.expression(red.expression) });
      case 'LocalDeclarationStatement': {
        const modifiers = red.modifiers,
          isConst = modifiers.some(m => m.text === 'const');
        if (red.awaitKeyword || modifiers.some(m => m.text !== 'const')) break;
        if (red.usingKeyword) return this.node('UsingDeclaration', red, { resources: this.local(red.declaration, red.declaration, red, isConst) });
        return this.local(red.declaration, red, red, isConst);
      }
      case 'CheckedStatement':
      case 'UncheckedStatement':
        return this.node('OverflowContext', red, { checked: red.kind === 'CheckedStatement', body: this.block(red.block) });
      case 'LabeledStatement':
        return this.node('Labeled', red, { label: red.identifier.valueText, body: this.statement(red.statement) });
      case 'UsingStatement':
        if (red.awaitKeyword) break;
        return this.node('Using', red, {
          resources: red.declaration ? this.local(red.declaration, red.declaration, red.declaration, false) : this.expression(red.expression),
          body: this.statement(red.statement)
        });
      case 'IfStatement':
        return this.node('If', red, {
          condition: this.expression(red.condition),
          then: this.statement(red.statement),
          otherwise: red.else ? this.statement(red.else.statement) : null
        });
      case 'SwitchStatement':
        return this.node('Switch', red, {
          expression: this.expression(red.expression),
          sections: red.sections.map(section =>
            this.node('SwitchSection', section, {
              labels: section.labels.map(label =>
                label.kind === 'DefaultSwitchLabel' ? null : label.kind === 'CaseSwitchLabel' ? this.expression(label.value) : this.unsupported(label)
              ),
              statements: section.statements.map(s => this.statement(s))
            })
          )
        });
      case 'WhileStatement':
        return this.node('While', red, { condition: this.expression(red.condition), body: this.statement(red.statement) });
      case 'DoStatement':
        return this.node('Do', red, { condition: this.expression(red.condition), body: this.statement(red.statement) });
      case 'ForStatement': {
        const initializers = red.initializers,
          incrementors = red.incrementors;
        if (initializers.length > 1) this.fail(initializers[1], 'SF1018', 'Multiple for-loop initializers are not implemented in this profile');
        if (incrementors.length > 1) this.fail(incrementors[1], 'SF1018', 'Multiple for-loop iterators are not implemented in this profile');
        const init = red.declaration
          ? this.local(red.declaration, red.declaration, red.declaration, false)
          : initializers.length
            ? this.expression(initializers[0])
            : null;
        return this.node('For', red, {
          init,
          condition: red.condition ? this.expression(red.condition) : null,
          increment: incrementors.length ? this.expression(incrementors[0]) : null,
          body: this.statement(red.statement)
        });
      }
      case 'ForEachStatement':
        if (red.awaitKeyword) break;
        return this.node('Foreach', red, {
          type: this.type(red.type),
          name: red.identifier.valueText,
          nameSpan: this.nameSpan(red.identifier),
          expression: this.expression(red.expression),
          body: this.statement(red.statement)
        });
      case 'ReturnStatement':
        return this.node('Return', red, { expression: red.expression ? this.expression(red.expression) : null });
      case 'BreakStatement':
        return this.node('Break', red, { label: red.label ? red.label.valueText : null });
      case 'ContinueStatement':
        return this.node('Continue', red, { label: red.label ? red.label.valueText : null });
      case 'ThrowStatement':
        return this.node('Throw', red, { expression: red.expression ? this.expression(red.expression) : null });
      case 'TryStatement':
        return this.node('Try', red, {
          body: this.block(red.block),
          catches: red.catches.map(clause => {
            const id = clause.declaration?.identifier ?? null;
            return {
              type: clause.declaration ? this.type(clause.declaration.type) : 'Exception',
              name: id?.valueText,
              nameSpan: id ? this.nameSpan(id) : null,
              filter: clause.filter ? this.expression(clause.filter.filterExpression) : null,
              body: this.block(clause.block)
            };
          }),
          finallyBody: red.finally ? this.block(red.finally.block) : null
        });
    }
    return this.unsupported(red);
  }
}

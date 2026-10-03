import { LegacyExpressionAdapter } from './expressions.js';
import { statementForms } from './statement-forms.js';
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
    const form = statementForms[red.kind];
    return (form && form.call(this, red)) ?? this.unsupported(red);
  }
}

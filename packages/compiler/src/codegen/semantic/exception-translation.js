import {
  n
} from './node-factory.js';
import {
  exceptionTypeName
} from '../../symbols/exception-identity.js';

/** Preserve typed catches and executable filters through semantic lowering into source IR. */
export function translateExceptionStatement(translator, node) {
  const catches = node.catches.map(clause => {
    const type = translator.imageType(clause.type, clause.syntax);
    let variable = null;
    let filter = null;
    const body = translator.scoped(() => {
      let initializers = [];
      if (clause.local) {
        variable = n.newLocal(clause.local.name, type, n.spanOf(clause.local.syntax, translator.frame.uri), {
          hidden: false
        });
        if (translator.frame.captures.isCaptured(clause.local)) {
          initializers = translator.declareVariable(clause.local, n.local(variable));
        } else translator.frame.vars.set(clause.local, () => n.local(variable));
      }
      filter = clause.filter ? translator.expression(clause.filter) : null;
      if (filter && initializers.length) {
        filter = n.sequence([], initializers, filter);
        initializers = [];
      }
      return [...initializers, translator.statement(clause.block)];
    });
    body.syntax = translator.span(clause.block.syntax);
    return {
      kind: 'CatchBlock',
      exceptionType: exceptionTypeName(type),
      local: variable,
      filter,
      body
    };
  });
  const span = translator.span(node.syntax);
  if (!catches.length && node.finallyBlock) {
    const statement = translator.protect(node.body, () => translator.statement(node.body), () => translator.statement(node.finallyBlock));
    return statement.kind === 'TryStatement' ? {
      ...statement,
      syntax: span
    } : statement;
  }
  return n.tryStatement(translator.statement(node.body), catches,
    node.finallyBlock ? translator.statement(node.finallyBlock) : null, span);
}

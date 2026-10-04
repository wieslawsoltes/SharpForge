import {DiagnosticId} from '../diagnostics/codes.js';
import {LocalDeclarationKind} from '../symbols/members.js';
import {isExceptionType} from '../symbols/exception-identity.js';
import {BoundCatchBlock, BoundTryStatement, BoundThrowStatement} from '../bound/nodes.js';

export function bindLegacyThrow(binder, node) {
  const expression = node.expression ? binder.bindExpression(node.expression) : null;
  if (expression && expression.legacyType !== 'null' && !isExceptionType(binder.c, expression.legacyType)) {
    binder.c.report(node, DiagnosticId.CS0155);
  } else if (!expression && !binder.catchDepth) binder.c.report(node, DiagnosticId.CS0156);
  return binder.statement(BoundThrowStatement, node, {expression});
}

/** Bind filters in the catch variable's scope, before the handler body. */
export function bindLegacyTry(binder, node) {
  const tryBlock = binder.bindStatement(node.body);
  const catchBlocks = node.catches.map(clause => {
    binder.pushScope();
    const type = binder.c.resolveType(clause.type, node, false, binder.m);
    if (!isExceptionType(binder.c, type)) binder.c.report(node, DiagnosticId.CS0155);
    const local = clause.name ? binder.local(clause.name, type,
      {...clause.body, name: clause.name, nameSpan: clause.nameSpan}, false,
      {declarationKind: LocalDeclarationKind.Catch}) : null;
    const filter = clause.filter ? binder.bindBool(clause.filter) : null;
    binder.catchDepth++;
    const body = binder.bindStatement(clause.body);
    binder.catchDepth--;
    binder.popScope();
    return binder.statement(BoundCatchBlock, clause.body, {exceptionType: binder.type(type), local, filter, body});
  });
  let finallyBlock = null;
  if (node.finallyBody) {
    binder.finallyScopes.push(binder.loops.length);
    finallyBlock = binder.bindStatement(node.finallyBody);
    binder.finallyScopes.pop();
  }
  return binder.statement(BoundTryStatement, node, {tryBlock, catchBlocks, finallyBlock});
}

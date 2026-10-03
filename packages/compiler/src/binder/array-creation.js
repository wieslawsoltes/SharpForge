import {DiagnosticId} from '../diagnostics/codes.js';
import {BoundArrayCreation} from '../bound/nodes.js';
import {boxPrimitiveValue} from './value-arguments.js';

/** Bind a rank-one execution-profile array and its target-typed initializer values. */
export function bindArrayCreation(binder, syntax) {
  let type = syntax.type;
  if (type === 'var[]') {
    if (!syntax.values?.length) binder.c.report(syntax, DiagnosticId.CS0826);
    type = (syntax.values?.length ? binder.infer(syntax.values[0]) : 'error') + '[]';
  }
  type = binder.c.resolveType(type, syntax, false, binder.m);
  const element = type.slice(0, -2);
  let length = null;
  if (syntax.length) {
    length = binder.bindExpression(syntax.length);
    binder.checkAssign('int', length.legacyType, syntax.length);
  }
  const initializer = (syntax.values ?? []).map(syntaxValue => {
    const value = binder.bindTyped(syntaxValue, element);
    binder.checkAssign(element, value.legacyType, syntaxValue);
    return boxPrimitiveValue(binder, value, element);
  });
  return binder.node(BoundArrayCreation, syntax, {length, initializer, hasInitializer: !!syntax.values}, type);
}

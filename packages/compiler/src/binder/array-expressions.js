import {BoundArrayAccess, BoundArrayCreation, BoundConversion} from '../bound/nodes.js';
import {integral} from '../numeric.js';

export function bindVectorIndex(binder, syntax) {
  const value = binder.bindExpression(syntax), type = value.legacyType;
  if (!integral(type)) { binder.c.report(syntax, 'CS0266', [type, 'int']); return value; }
  const target = type === 'uint' ? 'nuint' : ['long', 'ulong'].includes(type) ? 'nint' : type;
  if (target === type) return value;
  return binder.node(BoundConversion, syntax, {
    operand: value, conversion: {kind: 'ImplicitNumeric', from: type, to: target}, isExplicit: false, isChecked: type !== 'uint',
  }, target);
}

export function bindVectorExpression(binder, syntax) {
  if (syntax.kind === 'Index') {
    const type = binder.infer(syntax.target);
    if (!type.endsWith('[]')) return undefined;
    if ((syntax.indices?.length ?? 1) !== 1) binder.c.report(syntax, 'CS0022', [1]);
    return binder.node(BoundArrayAccess, syntax, {
      expression: binder.bindExpression(syntax.target), index: bindVectorIndex(binder, syntax.index),
    }, type.slice(0, -2));
  }
  if (syntax.kind !== 'NewArray') return undefined;
  let type = syntax.type;
  if (type === 'var[]') {
    if (!syntax.values?.length) binder.c.report(syntax, 'CS0826');
    type = (syntax.values?.length ? binder.infer(syntax.values[0]) : 'error') + '[]';
  }
  type = binder.c.resolveType(type, syntax, false, binder.m);
  const element = type.slice(0, -2), length = syntax.length ? bindVectorIndex(binder, syntax.length) : null;
  const initializer = (syntax.values ?? []).map(value => {
    const result = binder.bindTyped(value, element);
    binder.checkAssign(element, result.legacyType, value);
    return result;
  });
  return binder.node(BoundArrayCreation, syntax, {length, initializer, hasInitializer: !!syntax.values}, type);
}

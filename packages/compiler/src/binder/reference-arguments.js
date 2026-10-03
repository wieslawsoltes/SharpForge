import {BoundCall} from '../bound/nodes.js';

/** Legacy bound-profile bridge: the semantic pipeline binds ref kinds before lowering. */
export function bindAddressArgument(binder, argument, targetType) {
  const expression = argument.expression ?? argument;
  const target = binder.bindExpression(expression);
  const type = targetType.replace(/&$/, '');
  const readonly = argument.modifier === 'in';
  if (target.legacyType !== type) binder.c.report(expression, 'CS1503', [1, target.legacyType, type]);
  if (!['Local', 'Parameter', 'FieldAccess', 'ArrayAccess', 'IndexerAccess'].includes(target.kind)) {
    binder.c.report(expression, 'CS1510');
    return binder.bad(expression, [target], type + '&');
  }
  const symbol = target.local ?? target.parameter;
  if (!readonly && (symbol?.isConst || ['in', 'ref readonly'].includes(symbol?.refKind) || target.indexer?.memory?.readonly)) {
    binder.c.report(expression, 'CS1510');
  }
  return binder.node(BoundCall, argument, {receiver: null, method: null, args: [target],
    intrinsic: {reference: {readonly, out: argument.modifier === 'out'}}}, type + '&');
}

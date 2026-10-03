import {MethodKind} from '../../symbols/members.js';
import {n} from './node-factory.js';

/** Framework events require native delegates, retaining target/method equality for removal. */
export function frameworkEventAssignment(translator, node, event) {
  const accessor = node.operator === '+=' ? event.addMethod : event.removeMethod;
  const contract = accessor?.contract;
  if (!contract) return translator.unsupported('an unregistered framework event accessor', node.syntax);
  const handler = frameworkDelegateValue(translator, node.handler, contract.parameters[0]);
  const receiver = contract.isStatic ? null : translator.expression(node.receiver);
  return n.frameworkCall(accessor, receiver, [handler], 'void');
}

export function frameworkDelegateValue(translator, node, type) {
  if (node.constantValue?.isNull || node.kind === 'Literal' && node.literal === 'null') return n.nullLiteral(type);
  if (node.kind === 'DelegateCreation') return frameworkDelegateValue(translator, node.operand, type);
  if (node.kind === 'Conversion' && ['Identity', 'ImplicitReference'].includes(node.conversion?.kind)) {
    return frameworkDelegateValue(translator, node.operand, type);
  }
  if (node.kind !== 'Conversion' || node.conversion?.kind !== 'MethodGroup') {
    return translator.unsupported('framework delegate arguments other than method groups', node.syntax);
  }
  const group = node.operand;
  const method = node.conversion.method ?? node.method ?? group.selected
    ?? (group.methods?.length === 1 ? group.methods[0] : null);
  const definition = method?.originalDefinition ?? method;
  if (!definition || !translator.g.isSource(definition) || definition.typeParameters?.length
      || definition.methodKind === MethodKind.LocalFunction) {
    return translator.unsupported('this framework delegate method group', node.syntax);
  }
  const record = translator.g.methodOf(definition, node.syntax);
  const receiver = record.isStatic ? null : group.receiver ? translator.expression(group.receiver) : translator.frame.thisExpr?.();
  if (!record.isStatic && !receiver) return translator.unsupported('a framework delegate without a receiver', node.syntax);
  return n.frameworkDelegate(type, record, receiver);
}

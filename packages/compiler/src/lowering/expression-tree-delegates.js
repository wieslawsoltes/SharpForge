/** Method groups and delegate construction inside expression trees (SF-A02-T07.5). */
import { MethodKind } from '../symbols/members.js';
import { expressionTreeMethods } from '../symbols/expression-tree-methods.js';

/** Roslyn represents a delegate as a Convert over a MethodInfo.CreateDelegate call in the tree. */
function delegateCreation(builder, method, receiver, type, origin) {
  if (!method) builder.fail('a delegate without a selected method', origin);
  if (method.methodKind === MethodKind.LocalFunction) builder.fail('a reference to a local function', origin);
  const methods = expressionTreeMethods(builder.core),
    selected = method.reducedFrom ?? method;
  let target = receiver ?? builder.constant(null, builder.core.object);
  if (receiver && receiver.type?.isReferenceType !== true)
    target = builder.node('Convert', builder.core.object, { operands: [receiver] });
  const call = builder.node('Call', builder.core.delegate, {
    object: builder.node('Constant', methods.methodInfo, { methodValue: selected }),
    method: methods.createDelegate,
    arguments: [builder.node('Constant', builder.core.type, { typeValue: type }), target],
  });
  return builder.node('Convert', type, { operands: [call] });
}

/** A selected static, instance, or reduced extension method group. */
export function methodGroupTree(builder, node) {
  const group = node.operand,
    method = node.conversion.method ?? group.methods?.[0],
    closedExtension = !!method?.isExtensionMethod && !!group.receiver,
    isStatic = !!method?.isStatic && !closedExtension;
  const receiver = isStatic ? null : group.receiver
    ? builder.visit(group.receiver)
    : builder.node('Constant', group.receiverType ?? method?.containingType, { isThis: true });
  return delegateCreation(builder, method, receiver, node.type, node);
}

function explicitDelegateCreation(node) {
  const operand = node.operand;
  if (!operand) this.fail('a delegate without an operand', node);
  if (operand.kind === 'Lambda') return this.lambda(operand, node.type);
  if (operand.kind === 'Conversion' && ['AnonymousFunction', 'MethodGroup'].includes(operand.conversion?.kind)) return this.visit(operand);
  return delegateCreation(this, operand.type?.delegateInvokeMethod, this.visit(operand), node.type, node);
}

export const expressionTreeDelegateVisitors = Object.freeze({ DelegateCreation: explicitDelegateCreation });

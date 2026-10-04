/**
 * Which bound nodes are late-bound operations on a value of type `dynamic` (SF-A02-T55): the nodes binder/dynamic.js
 * marks `isDynamic`, operators with a dynamic operand, and a conversion from `dynamic` to anything but `object`.
 * Code generation reports them (lowering/dynamic.js) and an expression tree may not contain one (CS1963).
 */
import { TypeKind } from '../symbols/types.js';

const isDynamic = type => type?.typeKind === TypeKind.Dynamic;

/** What each late-bound operation is called in a diagnostic. */
export const dynamicOperationNames = Object.freeze({
  DynamicMemberAccess: 'a member access',
  DynamicInvocation: 'an invocation',
  DynamicElementAccess: 'an element access',
  DynamicObjectCreation: 'a constructor call',
  DynamicCondition: 'an operator',
  Unary: 'an operator',
  Binary: 'an operator',
  Increment: 'an operator',
  CompoundAssignment: 'an operator',
  Await: 'an await',
  Conversion: 'a conversion',
  ForEach: 'an enumeration',
  Using: 'a conversion',
});

/** The name of the late-bound operation a bound node stands for, or null when it is bound statically. */
export function dynamicOperation(node) {
  switch (node.kind) {
    case 'Unary':
    case 'Increment':
      return isDynamic(node.operand?.type) ? dynamicOperationNames[node.kind] : null;
    case 'Binary':
      return isDynamic(node.left?.type) || isDynamic(node.right?.type) ? dynamicOperationNames.Binary : null;
    case 'CompoundAssignment':
      return isDynamic(node.left?.type) || isDynamic(node.operation?.type) ? dynamicOperationNames.CompoundAssignment : null;
    case 'Conversion': {
      const isToObject = node.type?.specialType === 'System_Object' || isDynamic(node.type);
      return isDynamic(node.operand?.type) && !isToObject ? dynamicOperationNames.Conversion : null;
    }
    default:
      return node.isDynamic ? (dynamicOperationNames[node.kind] ?? 'an operation') : null;
  }
}

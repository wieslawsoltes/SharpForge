/** Static argument information retained by the Microsoft.CSharp binder protocol (SF-A02-T55). */
import { RefKind, TypeKind } from '../../symbols/types.js';

export const DynamicArgumentFlags = Object.freeze({
  UseCompileTimeType: 1,
  Constant: 2,
  NamedArgument: 4,
  IsRef: 8,
  IsOut: 16,
  IsStaticType: 32,
});

export const DynamicBinderFlags = Object.freeze({
  CheckedContext: 1,
  InvokeSimpleName: 2,
  InvokeSpecialName: 4,
  BinaryOperationLogical: 8,
  ConvertExplicit: 16,
  ConvertArrayIndex: 32,
  ResultIndexed: 64,
  ValueFromCompoundAssignment: 128,
  ResultDiscarded: 256,
});

export const isDynamicType = type => type?.typeKind === TypeKind.Dynamic;
export const isDynamicLocation = node => node?.kind === 'DynamicMemberAccess' || node?.kind === 'DynamicElementAccess';
export const isDynamicBinary = node => isDynamicType(node.left?.type) || isDynamicType(node.right?.type);
export const isDynamicConversion = node => isDynamicType(node.operand?.type)
  && !isDynamicType(node.type) && node.type?.specialType !== 'System_Object';

/** Remove only the implicit representation conversion used when assigning a typed value to dynamic. */
export function dynamicAssignmentValue(node) {
  return node?.kind === 'Conversion' && !node.isExplicit && isDynamicType(node.type) ? node.operand : node;
}

/** Runtime representation and CSharpArgumentInfo flags of one argument. */
export function dynamicArgument(expression, core, { refKind = RefKind.None, name = null, staticType = null } = {}) {
  const reference = refKind && refKind !== RefKind.None;
  const type = staticType ? core.type : !expression?.type || isDynamicType(expression.type) ? core.object : expression.type;
  let flags = staticType ? DynamicArgumentFlags.IsStaticType | DynamicArgumentFlags.UseCompileTimeType : 0;
  if (expression?.type && !isDynamicType(expression.type)) flags |= DynamicArgumentFlags.UseCompileTimeType;
  if (expression?.constantValue) flags |= DynamicArgumentFlags.Constant;
  if (name !== null) flags |= DynamicArgumentFlags.NamedArgument;
  if (reference) flags |= DynamicArgumentFlags.UseCompileTimeType
    | (refKind === RefKind.Out ? DynamicArgumentFlags.IsOut : DynamicArgumentFlags.IsRef);
  return { expression, type, refKind: reference ? refKind : RefKind.None, name, flags, staticType };
}

/** A receiver's storage/ref kind is resolved by binding, including readonly and ref-returning locations. */
export function dynamicReceiver(expression, core, refKind = RefKind.None) {
  return dynamicArgument(expression, core, { refKind });
}

/** The receiver of a method group, including unqualified static and instance calls. */
export function dynamicGroupReceiver(group, context, core) {
  const isStatic = group.viaType || (!group.receiver && (context.isStatic || group.methods.every(method => method.isStatic)));
  if (isStatic) return dynamicArgument(null, core, { staticType: group.receiverType ?? context.owner });
  const receiver = group.receiver ?? { kind: 'This', type: context.owner, syntax: group.syntax, isImplicit: true };
  return dynamicReceiver(receiver, core, group.receiverRefKind);
}

/** Source-order arguments, before optional/default/params expansion: that work belongs to the runtime binder. */
export function dynamicArguments(argumentsList, core) {
  return argumentsList.map(argument => dynamicArgument(argument.expression, core, argument));
}

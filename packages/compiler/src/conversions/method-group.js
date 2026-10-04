/**
 * Method group and delegate conversions (SF-A02-T06.7, C# spec 10.8).
 *
 * A method group converts to a delegate type D when overload resolution with D's parameter types (and ref kinds) as
 * the argument list selects one method M, M's parameters accept D's by identity or implicit reference conversion, and
 * M's return type converts to D's by identity or implicit reference conversion (or both are void).
 *   CS0123  no overload matches the delegate            CS0407  the selected method has the wrong return type
 *   CS0121  the group is ambiguous for the delegate     CS8917  no natural type (handled by the caller)
 * C# 7.3 "improved candidates": static methods are dropped when the group has an instance receiver (and instance
 * methods when it has none) before resolution, and candidates failing their constraints are discarded.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind, TypeKind } from '../symbols/types.js';
import { Conversion, ConversionKind } from './classify.js';
import { delegateInvoke } from '../overload/type-inference.js';

/** The synthetic argument list a delegate signature stands for: one typed argument per parameter. */
export function delegateArguments(invoke) {
  return invoke.parameters.map(p => ({ type: p.type, refKind: p.refKind === RefKind.None ? null : p.refKind, isDelegateParameter: true }));
}
/**
 * @param {{methods:MethodSymbol[],hasReceiver?:boolean,isStaticContext?:boolean,typeArguments?:TypeSymbol[],name?:string}} group
 * @param delegateType the target type  @param resolver OverloadResolver
 * @param {{improvedCandidates?:boolean,satisfiesConstraints?:(method)=>boolean}} [options]
 * @returns {{conversion:Conversion,method?:MethodSymbol,error?:{code,args}}}
 */
export function convertMethodGroup(group, delegateType, resolver, options = {}) {
  const none = error => ({ conversion: new Conversion(ConversionKind.NoConversion), error });
  const invoke = delegateInvoke(delegateType);
  if (!invoke) return none({ code: DiagnosticId.CS0428, args: [group.name ?? group.methods[0]?.name ?? '', delegateType.toDisplayString()] });
  let methods = group.methods;
  if (options.improvedCandidates !== false) {
    // C# 7.3: the receiver kind prunes the group before resolution.
    const filtered = methods.filter(
      m =>
        group.hasReceiver === undefined || m.isExtensionMethod || (group.hasReceiver ? !m.isStatic : m.isStatic || !group.isStaticContext),
    );
    if (filtered.length) methods = filtered;
    if (options.satisfiesConstraints) {
      const ok = methods.filter(m => !m.arity || options.satisfiesConstraints(m));
      if (ok.length) methods = ok;
    }
  }
  const args = delegateArguments(invoke),
    name = group.name ?? methods[0]?.name ?? '';
  const result = resolver.resolve(methods, args, { typeArguments: group.typeArguments ?? null, name });
  if (!result.succeeded) {
    if (result.error.code === DiagnosticId.CS0121) return none(result.error);
    return none({ code: DiagnosticId.CS0123, args: [name, delegateType.toDisplayString()] });
  }
  const method = result.method;
  // Parameters: identity or implicit reference only (no boxing, no numeric), matching ref kinds; params expansion does not apply.
  const parametersOk =
    !result.expanded &&
    method.parameters.length === invoke.parameters.length &&
    method.parameters.every(
      (p, i) =>
        p.refKind === invoke.parameters[i].refKind &&
        (p.refKind !== RefKind.None
          ? resolver.conversions.isIdentity(invoke.parameters[i].type, p.type)
          : resolver.conversions.hasIdentityOrReference(invoke.parameters[i].type, p.type)),
    );
  if (!parametersOk) return none({ code: DiagnosticId.CS0123, args: [name, delegateType.toDisplayString()] });
  const returnOk = invoke.returnsVoid
    ? method.returnsVoid
    : !method.returnsVoid &&
      method.refKind === invoke.refKind &&
      (method.refKind !== RefKind.None
        ? resolver.conversions.isIdentity(method.returnType, invoke.returnType)
        : resolver.conversions.hasIdentityOrReference(method.returnType, invoke.returnType));
  if (!returnOk)
    return {
      conversion: new Conversion(ConversionKind.NoConversion),
      method,
      error: { code: DiagnosticId.CS0407, args: [method.returnTypeWithAnnotations.toDisplayString() + ' ' + method.toDisplayString()] },
    };
  return { conversion: new Conversion(ConversionKind.MethodGroup, { method }), method };
}
/** Delegate-to-delegate compatibility used by `new D(otherDelegate)`: same signature up to reference conversions. */
export function delegatesAreCompatible(from, to, conversions) {
  const a = delegateInvoke(from),
    b = delegateInvoke(to);
  if (!a || !b || a.parameters.length !== b.parameters.length) return false;
  return (
    a.parameters.every(
      (p, i) => p.refKind === b.parameters[i].refKind && conversions.hasIdentityOrReference(b.parameters[i].type, p.type),
    ) && (a.returnsVoid ? b.returnsVoid : !b.returnsVoid && conversions.hasIdentityOrReference(a.returnType, b.returnType))
  );
}
/**
 * The natural (C# 10) function type of a method group or lambda signature: Action/Func when the signature fits them,
 * otherwise null (a synthesized delegate is needed). `parameterTypes` are bare types; ref parameters force synthesis.
 */
export function naturalDelegateType(core, parameterTypes, returnType, { hasRefParameters = false } = {}) {
  if (hasRefParameters || parameterTypes.length > 4 || parameterTypes.some(t => !t || t.typeKind === TypeKind.Pointer || t.isRefLikeType))
    return null;
  if (!returnType || returnType.specialType === 'System_Void')
    return parameterTypes.length ? core.action(parameterTypes.length).construct(parameterTypes) : core.action(0);
  if (parameterTypes.length > 4) return null;
  return core.func(parameterTypes.length + 1).construct([...parameterTypes, returnType]);
}

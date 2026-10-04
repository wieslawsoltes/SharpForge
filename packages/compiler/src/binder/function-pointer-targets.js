/** Function-pointer method selection reuses ordinary overload resolution, without expanded or optional arguments. */
import { DiagnosticId } from '../diagnostics/codes.js';
import { RefKind } from '../symbols/types.js';
import { MethodKind, MethodSymbol, ParameterSymbol, DeclarationModifiers } from '../symbols/members.js';
import { sameCallingConvention } from '../symbols/function-pointer-conventions.js';
import { methodCallingConvention } from './function-pointer-conventions.js';

/** The callable symbol of a function pointer, used by existing argument binding and ref-safety rules. */
export function functionPointerSignatureMethod(type) {
  const signature = type.signature;
  return new MethodSymbol({
    name: type.toDisplayString(),
    methodKind: MethodKind.FunctionPointerSignature,
    modifiers: DeclarationModifiers.Static,
    returnType: signature.returnType,
    refKind: signature.returnRefKind,
    parameters: signature.parameters.map(parameter => new ParameterSymbol({ type: parameter.type, refKind: parameter.refKind })),
    isImplicitlyDeclared: true,
  });
}

/** Selects a method without reporting diagnostics, so speculative overload resolution has no side effects. */
export function selectFunctionPointerTarget(group, type, resolver) {
  const signature = type.signature;
  const error = (code, args, atName = false) => ({ method: null, error: { code, args, atName } });
  const mismatch = () => error(DiagnosticId.CS8757, [group.name ?? group.methods[0]?.name ?? '', type.toDisplayString()]);
  if (group.isExtensionOnly) return error(DiagnosticId.CS8788, [], true);
  const args = signature.parameters.map(parameter => ({
    type: parameter.type.type,
    refKind: parameter.refKind,
    isDelegateParameter: true,
  }));
  const result = resolver.resolve(group.methods, args, { typeArguments: group.typeArguments, name: group.name });
  if (!result.succeeded) return result.error.code === DiagnosticId.CS0121 ? { method: null, error: result.error } : mismatch();
  const method = result.method;
  if (result.expanded || method.parameters.length !== args.length) return mismatch();
  const conversions = resolver.conversions;
  const parametersFit = method.parameters.every((parameter, index) => {
    const wanted = signature.parameters[index];
    return parameter.refKind === wanted.refKind && (parameter.refKind !== RefKind.None
      ? conversions.isIdentity(wanted.type.type, parameter.type)
      : conversions.hasIdentityOrReference(wanted.type.type, parameter.type));
  });
  if (!parametersFit) return mismatch();
  if (!method.isStatic) return error(DiagnosticId.CS8759, [method.toDisplayString()], true);
  if (method.isExtensionMethod && group.receiver && !group.viaType) return error(DiagnosticId.CS8788, [], true);
  const resultFits = signature.returnRefKind === method.refKind && (signature.returnRefKind !== RefKind.None
    ? conversions.isIdentity(method.returnType, signature.returnType.type)
    : conversions.hasIdentityOrReference(method.returnType, signature.returnType.type));
  if (!resultFits) return error(DiagnosticId.CS0407, [method.returnType.toDisplayString(), method.toDisplayString()], true);
  if (!sameCallingConvention(methodCallingConvention(method), signature)) {
    const wanted = signature.callingConvention === 'managed' ? 'Default' : signature.unmanagedConventions.join(', ') || 'Unmanaged';
    return error(DiagnosticId.CS8786, [method.toDisplayString(), wanted], true);
  }
  return { method, error: null };
}

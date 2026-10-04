/**
 * Interface and delegate variance (SF-A02-T02.5, C# spec 18.2.3).
 *
 * `hasVarianceConversion` decides whether a constructed generic interface or delegate converts to another
 * construction of the same definition: per type parameter, invariant arguments must be identical, `out` arguments
 * need an identity or implicit reference conversion A -> B and `in` arguments B -> A.
 * `checkVarianceSafety` validates a declaration: a covariant parameter may only appear output-safe, a contravariant
 * one input-safe (CS1961), walking return types, parameter types (flipped), ref/out parameters (invariant),
 * constraints on generic methods and nested constructed types.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { Variance, TypeKind, SymbolKind, NamedTypeSymbol, ArrayTypeSymbol, RefKind, typeOf } from '../symbols/types.js';

/**
 * @param from,to constructed named types  @param referenceConversion (a,b)=>boolean: identity or implicit reference conversion a -> b
 */
export function hasVarianceConversion(from, to, referenceConversion) {
  if (!(from instanceof NamedTypeSymbol) || !(to instanceof NamedTypeSymbol) || from.originalDefinition !== to.originalDefinition)
    return false;
  if (from.typeKind !== TypeKind.Interface && from.typeKind !== TypeKind.Delegate) return false;
  const parameters = from.originalDefinition.typeParameters;
  if (!parameters.length) return false;
  let variant = false;
  for (let i = 0; i < parameters.length; i++) {
    const a = from.typeArguments[i].type,
      b = to.typeArguments[i].type;
    if (a.equals(b)) continue;
    const variance = parameters[i].variance;
    // Variance needs reference types on both sides: IEnumerable<int> does not convert to IEnumerable<object>.
    if (variance === Variance.Out) {
      if (a.isReferenceType !== true || !referenceConversion(a, b)) return false;
    } else if (variance === Variance.In) {
      if (b.isReferenceType !== true || !referenceConversion(b, a)) return false;
    } else return false;
    variant = true;
  }
  const a = from.containingType,
    b = to.containingType;
  if (a && b && !a.equals(b)) return false;
  return variant;
}
const kindText = { [Variance.Out]: 'covariant', [Variance.In]: 'contravariant', [Variance.None]: 'invariant' };
const requiredText = { out: 'covariantly', in: 'contravariantly', invariant: 'invariantly' };
/**
 * Finds the first variance violation of `type` used in a position that requires `position`
 * ('out' = output-safe, 'in' = input-safe, 'invariant' = both). Returns `{parameter,required}` or null.
 */
export function varianceViolation(type, position) {
  type = typeOf(type);
  if (!type) return null;
  if (type.kind === SymbolKind.TypeParameter) {
    if (type.variance === Variance.None || type.typeParameterKind === 'method') return null;
    if (
      position === 'invariant' ||
      (position === 'out' && type.variance === Variance.In) ||
      (position === 'in' && type.variance === Variance.Out)
    )
      return { parameter: type, required: position };
    return null;
  }
  if (type instanceof ArrayTypeSymbol) return varianceViolation(type.elementType, position);
  if (
    (type instanceof NamedTypeSymbol && !type.isDefinition) ||
    (type instanceof NamedTypeSymbol &&
      type.arity &&
      type.typeArguments.some(a => a.type.kind === SymbolKind.TypeParameter && a.type.containingSymbol !== type))
  ) {
    const parameters = type.originalDefinition.typeParameters;
    for (let i = 0; i < parameters.length; i++) {
      const variance = parameters[i].variance,
        argument = type.typeArguments[i].type;
      // A covariant slot keeps the position, a contravariant one flips it, an invariant one demands both.
      const inner =
        variance === Variance.Out
          ? position
          : variance === Variance.In
            ? position === 'out'
              ? 'in'
              : position === 'in'
                ? 'out'
                : 'invariant'
            : 'invariant';
      const found = varianceViolation(argument, inner);
      if (found) return found;
    }
    if (type.containingType && !type.containingType.isDefinition) return varianceViolation(type.containingType, position);
  }
  return null;
}
/**
 * Declaration-site validity of a variant interface or delegate.
 * @param type the interface/delegate definition
 * @param {{staticMembers?:boolean}} [options] `staticMembers`: also check static members (the rule below C# 9: CS8904)
 * @returns [{code:'CS1961'|'CS8904',args,member,parameter}] - args are
 *   [member display, type parameter name, its declared variance, how the position needs it] as Roslyn formats them.
 */
export function checkVarianceSafety(type, { staticMembers = false } = {}) {
  const results = [];
  let inStaticMember = false;
  if (!type.typeParameters.some(p => p.variance !== Variance.None) && !hasVariantOuter(type)) return results;
  const report = (violation, member, where) => {
    if (violation)
      results.push({
        // A static member is exempt from C# 9 on: below it the violation names the version that lifts the rule.
        code: inStaticMember ? DiagnosticId.CS8904 : DiagnosticId.CS1961,
        args: [
          member.toDisplayString(),
          violation.parameter.name,
          kindText[violation.parameter.variance],
          requiredText[violation.required],
          ...(inStaticMember ? ['9.0'] : []),
        ],
        member,
        parameter: violation.parameter,
        where,
      });
  };
  const signature = (method, owner) => {
    if (!method.returnsVoid)
      report(
        varianceViolation(method.returnTypeWithAnnotations, method.refKind && method.refKind !== RefKind.None ? 'invariant' : 'out'),
        owner,
        'return',
      );
    for (const p of method.parameters)
      report(
        varianceViolation(p.typeWithAnnotations, p.refKind === RefKind.None || p.refKind === RefKind.In ? 'in' : 'invariant'),
        owner,
        p,
      );
    for (const tp of method.typeParameters) for (const c of tp.constraintTypes) report(varianceViolation(c, 'in'), owner, tp);
  };
  if (type.typeKind === TypeKind.Delegate) {
    const invoke = type.delegateInvokeMethod;
    if (invoke) signature(invoke, type);
    return results;
  }
  if (type.typeKind !== TypeKind.Interface) return results;
  for (const i of type.interfaces) report(varianceViolation(i, 'out'), type, 'base');
  for (const member of type.getMembers()) {
    if (member.isStatic && !staticMembers) continue;
    inStaticMember = !!member.isStatic;
    if (member.kind === SymbolKind.Method && !member.isAccessor) signature(member, member);
    else if (member.kind === SymbolKind.Property) {
      const position = member.getMethod && member.setMethod ? 'invariant' : member.setMethod ? 'in' : 'out';
      report(varianceViolation(member.typeWithAnnotations, position), member, 'type');
      for (const p of member.parameters) report(varianceViolation(p.typeWithAnnotations, 'in'), member, p);
    } else if (member.kind === SymbolKind.Event) report(varianceViolation(member.typeWithAnnotations, 'in'), member, 'type');
  }
  return results;
}
const hasVariantOuter = type => {
  for (let t = type.containingType; t; t = t.containingType) if (t.typeParameters.some(p => p.variance !== Variance.None)) return true;
  return false;
};

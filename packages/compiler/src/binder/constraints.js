/**
 * Generic constraint checking (SF-A02-T02.3, C# spec 8.4.5): does a type argument satisfy the constraints of the type
 * parameter it replaces?
 *   class        CS0452     struct      CS0453     new()        CS0310     unmanaged   CS8377
 *   base type / interface:  CS0311 (reference type argument), CS0315 (value type), CS0312/CS0313 (nullable value
 *   type), CS0314 (type parameter argument)                    notnull     a warning: nullable/constraint-checks.js
 *   ref struct argument without `allows ref struct`: CS9244;   System.Enum / System.Delegate are ordinary base-type
 *   constraints, `default` only disambiguates overrides.
 * Constraint types are substituted with the full argument list first, so `where T : IComparable<T>` is checked as
 * `IComparable<int>` for T = int.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, SymbolKind, TypeMap, Accessibility, typeOf } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { isNullableType } from '../conversions/nullable.js';
import { hasBoxingConversion, hasIdentityOrImplicitReference } from '../conversions/reference.js';
import { requiredMembersOf } from './members/required-members.js';

/** True when a type has a public parameterless instance constructor (every value type does). */
export function hasPublicParameterlessConstructor(type) {
  if (type.isValueType === true) return true;
  if (type.typeKind === TypeKind.TypeParameter) return type.hasConstructorConstraint || type.hasValueTypeConstraint;
  if (type.typeKind !== TypeKind.Class || type.isAbstract || type.isStatic) return false;
  return type
    .getMembers('.ctor')
    .some(
      c =>
        c.kind === SymbolKind.Method &&
        c.methodKind === MethodKind.Constructor &&
        c.parameters.length === 0 &&
        c.declaredAccessibility === Accessibility.Public,
    );
}
/** True for unmanaged types: primitives, enums, pointers and structs whose instance fields are all unmanaged. */
export function isUnmanagedType(type, seen = new Set()) {
  if (type.typeKind === TypeKind.Pointer || type.typeKind === TypeKind.Enum) return true;
  if (type.typeKind === TypeKind.TypeParameter) return type.hasUnmanagedTypeConstraint;
  if (isNullableType(type)) return isUnmanagedType(type.nullableUnderlyingType, seen);
  if (type.isValueType !== true) return false;
  if (type.specialType && type.specialType !== 'System_Nullable_T') return true;
  if (seen.has(type.originalDefinition)) return true;
  seen.add(type.originalDefinition);
  return type.getMembers().every(m => m.kind !== SymbolKind.Field || m.isStatic || isUnmanagedType(m.type, seen));
}
/**
 * @param {TypeParameterSymbol[]} parameters  @param {TypeSymbol[]} typeArguments (bare types, same length)
 * @param {{core:object,display:string,outerMap?:TypeMap}} context `display` is the generic type or method as printed in the message
 * @returns {{code:string,args:string[],index:number,severity?:string}[]} one entry per violated constraint
 */
export function checkConstraints(parameters, typeArguments, { core, display, outerMap = TypeMap.empty }) {
  const results = [],
    map = outerMap.with(parameters, typeArguments);
  parameters.forEach((parameter, index) => {
    const argument = typeOf(typeArguments[index]);
    if (!argument || argument.isErrorType()) return;
    const name = argument.toDisplayString(),
      push = (code, args, extra = {}) => results.push({ code, args, index, ...extra });
    if (argument.isRefLikeType || (argument.typeKind === TypeKind.TypeParameter && argument.allowsRefLikeType)) {
      if (!parameter.allowsRefLikeType) push(DiagnosticId.CS9244, [display, parameter.name, name]);
    }
    if (argument.isStatic) {
      push(DiagnosticId.CS0718, [name]);
      return;
    }
    if (argument.typeKind === TypeKind.Pointer || argument.specialType === 'System_Void') {
      push(DiagnosticId.CS0306, [name]);
      return;
    }
    if (parameter.hasReferenceTypeConstraint && argument.isReferenceType !== true) push(DiagnosticId.CS0452, [display, parameter.name, name]);
    if (parameter.hasUnmanagedTypeConstraint) {
      // A nullable value type is a struct of unmanaged fields, but the constraint also demands a non-nullable type.
      if (!isUnmanagedType(argument) || isNullableType(argument)) push(DiagnosticId.CS8377, [display, parameter.name, name]);
    } else if (parameter.hasValueTypeConstraint && (argument.isValueType !== true || isNullableType(argument)))
      push(DiagnosticId.CS0453, [display, parameter.name, name]);
    for (const constraint of parameter.constraintTypes) {
      const wanted = typeOf(map.substituteType(constraint));
      if (!wanted || wanted.isErrorType()) continue;
      if (argument.equals(wanted)) continue;
      const args = [display, wanted.toDisplayString(), parameter.name, name];
      if (argument.typeKind === TypeKind.TypeParameter) {
        if (!(hasIdentityOrImplicitReference(argument, wanted, core) || hasBoxingConversion(argument, wanted, core))) push(DiagnosticId.CS0314, args);
      } else if (isNullableType(argument)) {
        // A nullable value type satisfies only object/ValueType-like constraints through boxing of the underlying type.
        if (!(wanted.specialType === 'System_Object' || wanted.specialType === 'System_ValueType'))
          push(wanted.typeKind === TypeKind.Interface ? DiagnosticId.CS0313 : DiagnosticId.CS0312, args);
      } else if (argument.isRefLikeType) {
        // C# 13: a ref struct cannot be boxed, but it satisfies an interface constraint by implementing the interface
        // (whether the type parameter allows it is CS9244, above).
        if (!(argument.allInterfaces ?? []).some(candidate => candidate.equals(wanted))) push(DiagnosticId.CS0315, args);
      } else if (argument.isValueType === true) {
        if (!hasBoxingConversion(argument, wanted, core)) push(DiagnosticId.CS0315, args);
      } else if (!hasIdentityOrImplicitReference(argument, wanted, core)) push(DiagnosticId.CS0311, args);
    }
    if (parameter.hasConstructorConstraint && !hasPublicParameterlessConstructor(argument)) push(DiagnosticId.CS0310, [display, parameter.name, name]);
    else if (parameter.hasConstructorConstraint && requiredMembersOf(argument, core).length) push(DiagnosticId.CS9040, [name, parameter.name, display]);
  });
  return results;
}
/** Checks a constructed type (and, recursively, its type arguments and containers). @returns violations with the offending `type`. */
export function checkConstructedType(type, core, seen = new Set()) {
  const results = [];
  type = typeOf(type);
  if (!type || seen.has(type)) return results;
  seen.add(type);
  if (type.elementType) return checkConstructedType(type.elementType, core, seen);
  if (type.kind !== SymbolKind.NamedType || type.isDefinition || !type.typeArguments?.length) return results;
  const definition = type.originalDefinition,
    args = type.typeArguments.map(a => a.type);
  if (definition.typeParameters.length === args.length)
    for (const v of checkConstraints([...definition.typeParameters], args, {
      core,
      display: definition.toDisplayString(),
      outerMap: type.containingType?.typeMap ?? TypeMap.empty,
    }))
      results.push({ ...v, type });
  for (const a of args) results.push(...checkConstructedType(a, core, seen));
  return results;
}
/** Checks a constructed generic method. */
export function checkConstructedMethod(method, core) {
  const definition = method.constructedFrom ?? method;
  if (!definition.arity || definition === method) return [];
  return checkConstraints(
    [...definition.typeParameters],
    method.typeArguments.map(a => a.type),
    { core, display: definition.toDisplayString(), outerMap: method.containingType?.typeMap ?? TypeMap.empty },
  );
}

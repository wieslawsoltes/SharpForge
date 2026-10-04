/**
 * Reference, boxing and unboxing conversions and type tests across hierarchies (SF-A02-T03.5, C# spec 10.2.8-10.3.7).
 *
 * All functions take bare TypeSymbols and the compilation's CoreTypes. `is`/`as`/cast legality follows from them:
 * `canCast` is "an explicit conversion exists" (CS0030 otherwise) and `typeTestOutcome` says whether an `is` test is
 * always true, always false or decided at run time (CS0183/CS0184 warnings).
 */
import { TypeKind, SymbolKind, ArrayTypeSymbol, NamedTypeSymbol, TypeParameterSymbol, TypeCompareKind } from '../symbols/types.js';
import { baseTypeChain, allInterfacesOf, derivesFrom, effectiveBaseClass, effectiveInterfaces } from '../symbols/substitution.js';
import { hasVarianceConversion } from './variance.js';

const isObject = t => t.specialType === 'System_Object' || t.typeKind === TypeKind.Dynamic;
const isClassLike = t => t.typeKind === TypeKind.Class || t.typeKind === TypeKind.Delegate || t.typeKind === TypeKind.Array;
const isInterface = t => t.typeKind === TypeKind.Interface;
const isTypeParameter = t => t instanceof TypeParameterSymbol;
/** True when the type is known to be a reference type (classes, interfaces, delegates, arrays, dynamic, constrained type parameters). */
export const isReference = t => t.isReferenceType === true;
/** True when the type is known to be a value type (structs, enums, `struct`-constrained type parameters). */
export const isValue = t => t.isValueType === true;

/**
 * The same interface for a conversion: element names are not part of a tuple's identity, so `(int X, int Y)`
 * implements `IEquatable<(int X, int Y)>` through the `IEquatable<ValueTuple<int, int>>` its definition lists.
 */
const sameIgnoringTupleNames = (left, right) => left.equals(right, TypeCompareKind.IgnoreTupleNames);
/** `nint` is `IntPtr` to the runtime: it implements `INumber<nint>` through the `INumber<IntPtr>` its definition lists. */
const sameInterface = (left, right) => left.equals(right, TypeCompareKind.IgnoreTupleNames | TypeCompareKind.IgnoreNativeIntegers);

/** Identity or implicit reference conversion (the test variance and array covariance use). */
export function hasIdentityOrImplicitReference(from, to, core) {
  return sameIgnoringTupleNames(from, to) || hasImplicitReferenceConversion(from, to, core);
}
/** Implicit reference conversions (identity excluded). */
export function hasImplicitReferenceConversion(from, to, core) {
  if (from.equals(to)) return false;
  if (isTypeParameter(from)) {
    // A type parameter known to be a reference type converts by reference to its bases and constraint interfaces.
    if (!isReference(from)) return false;
    return typeParameterTargets(from, core).some(t => t.equals(to) || hasImplicitReferenceConversion(t, to, core)) || isObject(to);
  }
  if (!isReference(from)) return false;
  if (isObject(to)) return true;
  if (isTypeParameter(to)) return false;
  if (from instanceof ArrayTypeSymbol) {
    if (to instanceof ArrayTypeSymbol)
      return (
        from.rank === to.rank &&
        from.isSZArray === to.isSZArray &&
        isReference(from.elementType) &&
        hasImplicitReferenceConversion(from.elementType, to.elementType, core)
      );
    if (derivesFrom(core.array, to, core) || allInterfacesOf(core.array, core).some(i => i.equals(to))) return true;
    // S[] to IList<T> and its base interfaces when S -> T is an identity or implicit reference conversion.
    if (
      from.isSZArray &&
      to instanceof NamedTypeSymbol &&
      isInterface(to) &&
      to.typeArguments.length === 1 &&
      [core.ilistT, core.icollectionT, core.ienumerableT, core.ireadOnlyListT, core.ireadOnlyCollectionT].some(
        d => d === to.originalDefinition,
      )
    )
      return hasIdentityOrImplicitReference(from.elementType, to.typeArguments[0].type, core);
    return false;
  }
  if (isClassLike(from) && to.typeKind !== TypeKind.Interface) {
    if (derivesFrom(from, to, core)) return true;
  }
  if (isInterface(to)) {
    if (allInterfacesOf(from, core).some(i => sameIgnoringTupleNames(i, to))) return true;
    // Variance: any implemented construction (or `from` itself) that is variance-convertible to `to`.
    const reference = (a, b) => hasIdentityOrImplicitReference(a, b, core);
    return [from, ...allInterfacesOf(from, core)].some(i => hasVarianceConversion(i, to, reference));
  }
  if (from.typeKind === TypeKind.Delegate && to.typeKind === TypeKind.Delegate)
    return hasVarianceConversion(from, to, (a, b) => hasIdentityOrImplicitReference(a, b, core));
  return false;
}
const typeParameterTargets = (parameter, core) => [
  effectiveBaseClass(parameter, core),
  ...effectiveInterfaces(parameter),
  ...parameter.constraintTypes.map(c => c.type ?? c).filter(isTypeParameter),
];
/** Boxing: a value type (or a type parameter not known to be a reference type) to object, ValueType, Enum or an implemented interface. */
export function hasBoxingConversion(from, to, core) {
  if (isTypeParameter(from)) {
    if (isReference(from)) return false;
    return (
      isObject(to) ||
      typeParameterTargets(from, core).some(
        t => t.equals(to) || (!isTypeParameter(t) && (hasImplicitReferenceConversion(t, to, core) || hasBoxingConversion(t, to, core))),
      ) ||
      (to.equals(core.valueType) && from.isValueType)
    );
  }
  if (!isValue(from)) return false;
  if (from.isRefLikeType) return false;
  if (from.isNullableValueType) {
    const u = from.nullableUnderlyingType;
    return hasBoxingConversion(u, to, core);
  }
  if (isObject(to) || to.equals(core.valueType)) return true;
  if (from.typeKind === TypeKind.Enum && to.equals(core.enumType)) return true;
  if (isInterface(to)) {
    const reference = (a, b) => hasIdentityOrImplicitReference(a, b, core);
    return allInterfacesOf(from, core).some(i => sameInterface(i, to) || hasVarianceConversion(i, to, reference));
  }
  return false;
}
/** Explicit reference conversions (those that are not implicit). */
export function hasExplicitReferenceConversion(from, to, core) {
  if (from.equals(to) || hasImplicitReferenceConversion(from, to, core)) return false;
  if (isTypeParameter(from) || isTypeParameter(to))
    return (
      typeParameterExplicit(from, to, core) && isReference(isTypeParameter(to) ? to : from) && (!isTypeParameter(from) || isReference(from))
    );
  if (!isReference(from) || !isReference(to)) return false;
  if (isObject(from)) return true;
  if (from instanceof ArrayTypeSymbol && to instanceof ArrayTypeSymbol)
    return (
      from.rank === to.rank &&
      isReference(from.elementType) &&
      isReference(to.elementType) &&
      hasExplicitReferenceConversion(from.elementType, to.elementType, core)
    );
  if (to instanceof ArrayTypeSymbol)
    return (
      hasImplicitReferenceConversion(to, from, core) ||
      (isInterface(from) &&
        to.isSZArray &&
        from instanceof NamedTypeSymbol &&
        from.typeArguments.length === 1 &&
        (hasIdentityOrImplicitReference(to.elementType, from.typeArguments[0].type, core) ||
          hasExplicitReferenceConversion(from.typeArguments[0].type, to.elementType, core)))
    );
  if (from instanceof ArrayTypeSymbol)
    return (
      isInterface(to) &&
      from.isSZArray &&
      to instanceof NamedTypeSymbol &&
      to.typeArguments.length === 1 &&
      hasExplicitReferenceConversion(from.elementType, to.typeArguments[0].type, core)
    );
  // Base class to derived class.
  if (!isInterface(from) && !isInterface(to))
    return (
      derivesFrom(to, from, core) ||
      (from.typeKind === TypeKind.Delegate &&
        to.typeKind === TypeKind.Delegate &&
        from.originalDefinition === to.originalDefinition &&
        varianceCompatible(from, to, core))
    );
  // Class to interface: allowed unless the class is sealed and does not implement it.
  if (!isInterface(from) && isInterface(to)) return from.typeKind === TypeKind.Class && !from.isSealed;
  // Interface to class: allowed unless the class is sealed and does not implement the interface.
  if (isInterface(from) && !isInterface(to))
    return to.typeKind === TypeKind.Class && (!to.isSealed || allInterfacesOf(to, core).some(i => i.equals(from)));
  // Interface to interface that is not a base interface.
  return true;
}
const varianceCompatible = (from, to, core) =>
  from.typeArguments.every((a, i) => {
    const b = to.typeArguments[i].type;
    return a.type.equals(b) || (isReference(a.type) && isReference(b));
  });
function typeParameterExplicit(from, to, core) {
  if (isTypeParameter(to)) {
    if (isObject(from) || from.equals(core.valueType)) return true;
    if (isInterface(from)) return true;
    // From the effective base class or any of its bases, and from a type parameter `to` depends on.
    if (isTypeParameter(from)) return dependsOn(to, from);
    return (
      baseTypeChain(effectiveBaseClass(to, core), core).some(t => t.equals(from)) || derivesFrom(effectiveBaseClass(to, core), from, core)
    );
  }
  // From a type parameter to any interface it is not known to implement, or to a type it depends on.
  return isInterface(to) && !effectiveInterfaces(from).some(i => i.equals(to));
}
const dependsOn = (parameter, other, seen = new Set()) => {
  if (seen.has(parameter)) return false;
  seen.add(parameter);
  return parameter.constraintTypes.some(c => {
    const t = c.type ?? c;
    return t === other || (isTypeParameter(t) && dependsOn(t, other, seen));
  });
};
/** Unboxing: object, ValueType, Enum or an interface to a value type (or a type parameter not known to be a reference type). */
export function hasUnboxingConversion(from, to, core) {
  if (isTypeParameter(to)) return !isReference(to) && typeParameterExplicit(from, to, core);
  // A type parameter not known to be a reference type converts explicitly to any interface it is not known to implement.
  if (isTypeParameter(from)) return !isReference(from) && isInterface(to) && !hasBoxingConversion(from, to, core);
  if (!isValue(to) || to.isRefLikeType) return false;
  const target = to.isNullableValueType ? to.nullableUnderlyingType : to;
  if (isObject(from) || from.equals(core.valueType)) return true;
  if (from.equals(core.enumType)) return target.typeKind === TypeKind.Enum;
  if (isInterface(from))
    return allInterfacesOf(target, core).some(
      i => i.equals(from) || hasVarianceConversion(i, from, (a, b) => hasIdentityOrImplicitReference(a, b, core)),
    );
  return false;
}
/**
 * The compile-time outcome of `expression is T` for an operand of static type `from` (ignoring null):
 * 'always' (identity, implicit reference or boxing), 'never' (no conversion at all), or 'runtime'.
 */
export function typeTestOutcome(from, to, core) {
  if (from.equals(to) || hasImplicitReferenceConversion(from, to, core) || hasBoxingConversion(from, to, core)) return 'always';
  if (from.isNullableValueType && from.nullableUnderlyingType.equals(to)) return 'runtime';
  if (hasExplicitReferenceConversion(from, to, core) || hasUnboxingConversion(from, to, core)) return 'runtime';
  if (isTypeParameter(from) || isTypeParameter(to)) return 'runtime';
  return 'never';
}
/** `e as T` needs T to be a reference type or nullable value type (CS0077 otherwise). */
export function asOperatorTargetValid(to) {
  return isReference(to) || to.isNullableValueType || (to instanceof TypeParameterSymbol && to.isReferenceType === true);
}

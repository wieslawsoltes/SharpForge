/**
 * Span conversions (C# 14 "first-class spans", csharp-14.0/first-class-span-types).
 *
 *   implicit   T[] -> Span<T>                         T[] / Span<T> / ReadOnlySpan<T> -> ReadOnlySpan<U> when T is U or
 *              string -> ReadOnlySpan<char>           converts to U by an implicit reference conversion
 *   explicit   T[] -> Span<U> / ReadOnlySpan<U> when a reference conversion (implicit or explicit) leads from T to U
 *              and the conversion is not already implicit
 * When a span conversion exists between two types in either form, user-defined conversion operators between them are
 * not considered: the operators the span types declare for the same pairs would otherwise make the result ambiguous
 * or change its kind.
 */
import { NamedTypeSymbol, ArrayTypeSymbol } from '../symbols/types.js';
import { hasImplicitReferenceConversion, hasExplicitReferenceConversion } from './reference.js';

/** The element type of `System.Span<T>` / `System.ReadOnlySpan<T>` (`name`), or null for any other type. */
export function spanElementType(type, name) {
  if (!(type instanceof NamedTypeSymbol) || type.isDefinition) return null;
  const definition = type.originalDefinition;
  const isSpan = definition.name === name && definition.arity === 1 && definition.containingNamespace?.name === 'System';
  return isSpan ? type.typeArguments[0].type : null;
}

const isCovariant = (from, to, core) => to.equals(from) || hasImplicitReferenceConversion(from, to, core);

/** True when an implicit span conversion leads from `from` to `to`. */
export function hasImplicitSpanConversion(from, to, core) {
  const readOnlyTarget = spanElementType(to, 'ReadOnlySpan');
  const spanTarget = spanElementType(to, 'Span');
  if (!readOnlyTarget && !spanTarget) return false;
  if (from instanceof ArrayTypeSymbol && from.isSZArray) {
    if (spanTarget) return spanTarget.equals(from.elementType);
    return isCovariant(from.elementType, readOnlyTarget, core);
  }
  if (!readOnlyTarget) return false;
  if (from.specialType === 'System_String') return readOnlyTarget.specialType === 'System_Char';
  const spanSource = spanElementType(from, 'Span');
  if (spanSource) return isCovariant(spanSource, readOnlyTarget, core);
  // ReadOnlySpan<T> -> ReadOnlySpan<U> is a conversion only when the element types differ (the same type is identity).
  const readOnlySource = spanElementType(from, 'ReadOnlySpan');
  return !!readOnlySource && !readOnlyTarget.equals(readOnlySource) && hasImplicitReferenceConversion(readOnlySource, readOnlyTarget, core);
}

/** True when an explicit (and not implicit) span conversion leads from the array type `from` to the span type `to`. */
export function hasExplicitSpanConversion(from, to, core) {
  if (!(from instanceof ArrayTypeSymbol) || !from.isSZArray) return false;
  const target = spanElementType(to, 'ReadOnlySpan') ?? spanElementType(to, 'Span');
  if (!target || hasImplicitSpanConversion(from, to, core)) return false;
  const element = from.elementType;
  return hasImplicitReferenceConversion(element, target, core) || hasExplicitReferenceConversion(element, target, core);
}

/**
 * The element types a span inference relates (csharp-14.0/first-class-span-types, "Type inference"): `V` is a
 * `Span<V1>` and `U` is an array `U1[]` or a `Span<U1>`, or `V` is a `ReadOnlySpan<V1>` and `U` is an array, a
 * `Span<U1>` or a `ReadOnlySpan<U1>`.
 * @returns {null|{source: object, target: object, isSpanTarget: boolean}} `source` is `U1`, `target` is `V1`
 */
export function spanInferencePair(u, v) {
  const spanTarget = spanElementType(v, 'Span'),
    target = spanTarget ?? spanElementType(v, 'ReadOnlySpan');
  if (!target) return null;
  const fromArray = u instanceof ArrayTypeSymbol && u.isSZArray ? u.elementType : null,
    source = fromArray ?? spanElementType(u, 'Span') ?? (spanTarget ? null : spanElementType(u, 'ReadOnlySpan'));
  return source ? { source, target, isSpanTarget: !!spanTarget } : null;
}

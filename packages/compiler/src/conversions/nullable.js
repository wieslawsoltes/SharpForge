/**
 * Nullable<T> and lifted conversions (SF-A02-T05.1, C# spec 10.2.6, 10.3.4, 10.6).
 *
 *   implicit:  S -> T?   when S -> T is identity or an implicit (numeric, constant, enumeration) conversion
 *              S? -> T?  when S -> T is identity or implicit
 *              null -> T?
 *   explicit:  S? -> T   (unwrap; throws InvalidOperationException when null), S -> T? and S? -> T? over an explicit
 *              or implicit underlying conversion
 * `classifyNullableConversion` composes an underlying classifier; the result names the wrap/unwrap steps so lowering
 * (lowering/nullable-operators.js) can emit `HasValue` / `GetValueOrDefault()` / `new T?(value)`.
 */
export const isNullableType = type => !!type && type.isNullableValueType === true && !type.isDefinition;
/** The T of T?, or the type itself. */
export const stripNullable = type => (isNullableType(type) ? type.nullableUnderlyingType : type);
/** True for types that can hold null: reference types, nullable value types, unconstrained/reference type parameters, pointers. */
export const canBeNull = type =>
  type.isReferenceType === true ||
  isNullableType(type) ||
  type.typeKind === 'pointer' ||
  type.typeKind === 'functionPointer' ||
  (type.typeKind === 'typeParameter' && type.isValueType !== true && type.isReferenceType === true);
/** True when null can be assigned (null literal conversion): reference types, T?, and pointers. */
export const acceptsNullLiteral = type =>
  type.isReferenceType === true ||
  isNullableType(type) ||
  type.typeKind === 'pointer' ||
  type.typeKind === 'functionPointer' ||
  type.typeKind === 'dynamic';
/**
 * @param from,to TypeSymbols, at least one of them nullable
 * @param {(from,to)=>'identity'|'implicit'|'explicit'|null} underlying classification of the non-nullable conversion
 * @returns {{kind:'implicit'|'explicit',steps:string[],underlying:string}|null}
 *   steps: 'wrap' (T -> T?), 'unwrap' (T? -> T, may throw), 'lift' (T? -> U? null-propagating)
 */
export function classifyNullableConversion(from, to, underlying) {
  const s = isNullableType(from),
    t = isNullableType(to);
  if (!s && !t) return null;
  const inner = underlying(stripNullable(from), stripNullable(to));
  if (!inner) return null;
  if (s && t) return { kind: inner === 'explicit' ? 'explicit' : 'implicit', steps: ['lift'], underlying: inner };
  if (t) return { kind: inner === 'explicit' ? 'explicit' : 'implicit', steps: ['wrap'], underlying: inner };
  return { kind: 'explicit', steps: ['unwrap'], underlying: inner };
}
/** The result type of a lifted operator: value results become nullable; comparison results stay bool. */
export function liftedResultType(resultType, operator, core) {
  if (['==', '!=', '<', '>', '<=', '>='].includes(operator)) return core.bool;
  return isNullableType(resultType) || resultType.isValueType !== true ? resultType : core.nullableOf(resultType);
}

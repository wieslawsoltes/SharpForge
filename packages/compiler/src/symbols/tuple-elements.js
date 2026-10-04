/**
 * The elements of a tuple type (SF-A02-T08.4).
 *
 * A tuple of up to seven elements is `System.ValueTuple<T1..Tn>`: its elements are its type arguments. A longer tuple
 * nests: the eighth type argument of `ValueTuple<T1..T7, TRest>` is the tuple of the remaining elements, so
 * `(T1..T9)` is `ValueTuple<T1..T7, ValueTuple<T8, T9>>`. Everything that treats a tuple element-wise (conversions,
 * equality, deconstruction, display, lowering) reads the flat list from here instead of the type arguments.
 *
 * This module depends on no other, so the symbol classes can use it.
 */

/** Elements one ValueTuple construction holds itself; the eighth type argument is the rest. */
export const tupleRestPosition = 7;

const isConstructedTuple = type => !!type?.isTupleType && !type.isDefinition;

/** True for a tuple type that nests its elements from the eighth on in `Rest`. */
export function isWideTuple(type) {
  return isConstructedTuple(type) && type.typeArguments.length === tupleRestPosition + 1 && isConstructedTuple(type.typeArguments[tupleRestPosition].type);
}

/** The element types (with annotations) of a tuple type, in order: the type arguments, with `Rest` flattened. */
export function tupleElements(type) {
  if (!isWideTuple(type)) return type.typeArguments;
  return (type.flatTupleElements ??= Object.freeze([
    ...type.typeArguments.slice(0, tupleRestPosition),
    ...tupleElements(type.typeArguments[tupleRestPosition].type),
  ]));
}

/** The number of elements of a tuple type. */
export const tupleCardinality = type => tupleElements(type).length;

/** `(int a, string)`: the display text of a tuple type; `display` renders one element type. */
export function tupleDisplay(type, display) {
  const names = type.tupleElementNames;
  return '(' + tupleElements(type).map((element, index) => display(element) + (names?.[index] ? ' ' + names[index] : '')).join(', ') + ')';
}

/**
 * The argument of `TupleElementNamesAttribute` for a type (SF-A02-T30), as Roslyn encodes it: the type is walked in
 * pre-order, and every tuple type met contributes one entry per element - its name, or null for an unnamed element.
 * The tuple nested in `Rest` of a long tuple is met again by the walk and contributes nulls, so the names of
 * `(int a, .., int i)` (nine elements) are followed by two nulls.
 *
 * A type without any element name has no attribute.
 */
import { ArrayTypeSymbol } from '../../symbols/types.js';
import { tupleElements } from '../../symbols/tuple-elements.js';

const isConstructedTuple = type => !!type?.isTupleType && !type.isDefinition;

function collect(type, names) {
  if (!type) return;
  if (type instanceof ArrayTypeSymbol) {
    collect(type.elementType, names);
    return;
  }
  if (isConstructedTuple(type)) {
    const count = tupleElements(type).length;
    for (let index = 0; index < count; index++) names.push(type.tupleElementNames?.[index] ?? null);
  }
  for (const argument of type.typeArguments ?? []) collect(argument.type ?? argument, names);
}

/**
 * @param type a type symbol
 * @returns {(string|null)[]|null} the transform names, or null when the type names no tuple element
 */
export function tupleElementNamesOf(type) {
  const names = [];
  collect(type, names);
  return names.some(name => name !== null) ? names : null;
}

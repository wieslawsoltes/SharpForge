/**
 * Questions about `dynamic` inside types (SF-A02-T55). `dynamic` exists only for the compiler: in metadata it is
 * `object`, so two signatures that differ only in `dynamic` versus `object` are the same signature, and a type that
 * mentions `dynamic` cannot stand where metadata needs the type itself (a base interface, a constraint).
 */
import { TypeKind, ArrayTypeSymbol } from './types.js';

/** True for the type `dynamic`. */
export const isDynamicType = type => type?.typeKind === TypeKind.Dynamic;

/** True when `type` is `dynamic` or mentions it in an element type or a type argument (`dynamic[]`, `List<dynamic>`). */
export function containsDynamic(type) {
  if (!type) return false;
  if (isDynamicType(type)) return true;
  if (type instanceof ArrayTypeSymbol) return containsDynamic(type.elementType);
  if (type.pointedAtType) return containsDynamic(type.pointedAtType);
  return (type.typeArguments ?? []).some(argument => (argument.type ?? argument) !== type && containsDynamic(argument.type ?? argument));
}

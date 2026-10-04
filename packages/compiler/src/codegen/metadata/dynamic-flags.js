/**
 * `[Dynamic]` transform flags (SF-A02-T30). `dynamic` is `object` in a signature; the attribute on the declaration
 * says which of the objects are dynamic. The flags follow the signature in prefix order - one for a by-reference
 * marker, one for each array, pointer and named type, then those of its type arguments - and are true exactly at
 * the positions of `dynamic`:
 *
 *   dynamic                      [true]     written as `[Dynamic]` without arguments
 *   dynamic[]                    [false, true]
 *   Dictionary<string, dynamic>  [false, false, true]
 *   ref dynamic                  [false, true]
 */
import { TypeKind, ArrayTypeSymbol, PointerTypeSymbol } from '../../symbols/types.js';
import { allTypeArguments } from '../generics.js';

function collect(type, flags) {
  if (type.typeKind === TypeKind.Dynamic) {
    flags.push(true);
    return;
  }
  flags.push(false);
  if (type instanceof ArrayTypeSymbol) collect(type.elementType, flags);
  else if (type instanceof PointerTypeSymbol) collect(type.pointedAtType, flags);
  else if (type.typeArguments?.length && !type.isDefinition) for (const argument of allTypeArguments(type)) collect(argument, flags);
}

/**
 * The transform flags of a declared type, or null for a type that does not mention `dynamic`.
 * @param type a type symbol  @param {boolean} [isByReference] the declaration is a `ref` / `out` / `in` slot
 * @returns {boolean[]|null}
 */
export function dynamicTransformFlags(type, isByReference = false) {
  if (!type) return null;
  const flags = isByReference ? [false] : [];
  collect(type, flags);
  return flags.includes(true) ? flags : null;
}

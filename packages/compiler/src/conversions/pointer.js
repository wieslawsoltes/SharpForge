/**
 * Pointer conversions (SF-A02-T47, C# spec 23.5), all of them only meaningful in an unsafe context:
 *
 *   implicit   any pointer type to `void*` (and the null literal to any pointer type, see ./nullable.js)
 *   function   a function pointer type (`delegate*<...>`) takes part like a data pointer type
 *   explicit   any pointer type to any other pointer type; sbyte, byte, short, ushort, int, uint, long, ulong (and the
 *              native integers) to any pointer type and back
 */
import { TypeKind } from '../symbols/types.js';

const integerKinds = new Set(['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'nint', 'nuint']);

/** True for `T*`. */
export const isPointerType = type => type?.typeKind === TypeKind.Pointer;
/** True for `delegate*<...>`. */
export const isFunctionPointerType = type => type?.typeKind === TypeKind.FunctionPointer;
/** True for `void*`. */
export const isVoidPointer = type => isPointerType(type) && type.pointedAtType?.specialType === 'System_Void';

/**
 * The pointer conversion from `from` to `to`, or null.
 * @param {(type: object) => string|null} kindOf the numeric kind of a type ('int', 'ulong', ...)
 * @returns {'ImplicitPointerToVoid'|'ExplicitPointerToPointer'|'ExplicitPointerToInteger'|'ExplicitIntegerToPointer'|null}
 */
export function pointerConversionKind(from, to, kindOf) {
  // A function pointer converts like a data pointer: implicitly to `void*`, explicitly to and from the others.
  const fromPointer = isPointerType(from) || isFunctionPointerType(from),
    toPointer = isPointerType(to) || isFunctionPointerType(to);
  if (fromPointer && toPointer) return isVoidPointer(to) ? 'ImplicitPointerToVoid' : 'ExplicitPointerToPointer';
  if (fromPointer && integerKinds.has(kindOf(to))) return 'ExplicitPointerToInteger';
  if (toPointer && integerKinds.has(kindOf(from))) return 'ExplicitIntegerToPointer';
  return null;
}

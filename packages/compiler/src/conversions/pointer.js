/**
 * Pointer conversions (SF-A02-T47, C# spec 23.5), all of them only meaningful in an unsafe context:
 *
 *   implicit   any pointer type to `void*` (and the null literal to any pointer type, see ./nullable.js)
 *   explicit   any pointer type to any other pointer type; sbyte, byte, short, ushort, int, uint, long, ulong (and the
 *              native integers) to any pointer type and back
 */
import { TypeKind } from '../symbols/types.js';

const integerKinds = new Set(['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'nint', 'nuint']);

/** True for `T*`. */
export const isPointerType = type => type?.typeKind === TypeKind.Pointer;
/** True for `void*`. */
export const isVoidPointer = type => isPointerType(type) && type.pointedAtType?.specialType === 'System_Void';

/**
 * The pointer conversion from `from` to `to`, or null.
 * @param {(type: object) => string|null} kindOf the numeric kind of a type ('int', 'ulong', ...)
 * @returns {'ImplicitPointerToVoid'|'ExplicitPointerToPointer'|'ExplicitPointerToInteger'|'ExplicitIntegerToPointer'|null}
 */
export function pointerConversionKind(from, to, kindOf) {
  const fromPointer = isPointerType(from),
    toPointer = isPointerType(to);
  if (fromPointer && toPointer) return isVoidPointer(to) ? 'ImplicitPointerToVoid' : 'ExplicitPointerToPointer';
  if (fromPointer && integerKinds.has(kindOf(to))) return 'ExplicitPointerToInteger';
  if (toPointer && integerKinds.has(kindOf(from))) return 'ExplicitIntegerToPointer';
  return null;
}

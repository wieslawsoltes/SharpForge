/**
 * What the CIL emitter needs to know about a type (SF-A02-T30): how a value of it sits on the evaluation stack and
 * which typed instructions move it to and from memory (ECMA-335 III.1.1, III.1.5).
 */
import { TypeKind } from '../../symbols/types.js';

/**
 * Primitive facts by special type: `stack` is the evaluation-stack kind, `bits` and `isSigned` describe the storage,
 * `suffix` completes `conv.`, `ldelem.`, `ldind.` and `store` completes `stelem.` and `stind.`.
 */
const primitives = Object.freeze({
  System_Boolean: { stack: 'i4', bits: 8, isSigned: false, suffix: 'u1', store: 'i1' },
  System_Char: { stack: 'i4', bits: 16, isSigned: false, suffix: 'u2', store: 'i2' },
  System_SByte: { stack: 'i4', bits: 8, isSigned: true, suffix: 'i1', store: 'i1' },
  System_Byte: { stack: 'i4', bits: 8, isSigned: false, suffix: 'u1', store: 'i1' },
  System_Int16: { stack: 'i4', bits: 16, isSigned: true, suffix: 'i2', store: 'i2' },
  System_UInt16: { stack: 'i4', bits: 16, isSigned: false, suffix: 'u2', store: 'i2' },
  System_Int32: { stack: 'i4', bits: 32, isSigned: true, suffix: 'i4', store: 'i4' },
  System_UInt32: { stack: 'i4', bits: 32, isSigned: false, suffix: 'u4', store: 'i4' },
  System_Int64: { stack: 'i8', bits: 64, isSigned: true, suffix: 'i8', store: 'i8' },
  System_UInt64: { stack: 'i8', bits: 64, isSigned: false, suffix: 'u8', store: 'i8', load: 'i8' },
  System_Single: { stack: 'r', bits: 32, isSigned: true, isFloat: true, suffix: 'r4', store: 'r4' },
  System_Double: { stack: 'r', bits: 64, isSigned: true, isFloat: true, suffix: 'r8', store: 'r8' },
  System_IntPtr: { stack: 'i', bits: 0, isSigned: true, suffix: 'i', store: 'i' },
  System_UIntPtr: { stack: 'i', bits: 0, isSigned: false, suffix: 'u', store: 'i', load: 'i' },
});

/** The type whose representation a value has: the underlying type of an enum, else the type itself. */
export function representationOf(type) {
  return type?.typeKind === TypeKind.Enum ? (type.enumUnderlyingType ?? type.originalDefinition?.enumUnderlyingType ?? null) : type;
}

/**
 * The primitive facts of a type (an enum has those of its underlying type), or null for anything else.
 * @returns {{stack: string, bits: number, isSigned: boolean, isFloat?: boolean, suffix: string, store: string,
 *   load?: string}|null}
 */
export function primitiveOf(type) {
  if (type?.typeKind === TypeKind.Enum) return primitives[representationOf(type)?.specialType ?? 'System_Int32'];
  return primitives[type?.specialType] ?? null;
}

/** True for a type whose values are object references on the stack. */
export function isReference(type) {
  if (!type) return true;
  if (type.typeKind === TypeKind.TypeParameter) return false;
  return !!type.isReferenceType || type.typeKind === TypeKind.Dynamic;
}

/** True for a struct that is not a primitive: its values are copied as a whole and addressed for member access. */
export function isStructValue(type) {
  return !!type && type.typeKind === TypeKind.Struct && !primitiveOf(type) && type.specialType !== 'System_Void';
}

/** True when a value of the type must be boxed to become an object reference. */
export function needsBox(type) {
  return !!type && (type.typeKind === TypeKind.TypeParameter || !!type.isValueType || !!primitiveOf(type));
}

export const isVoid = type => type?.specialType === 'System_Void';

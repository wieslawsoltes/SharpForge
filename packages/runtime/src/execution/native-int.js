import {isNativeInteger, nativeIntegerBits} from '@sharpforge/bytecode';
export {nativeIntegerBits, isNativeInteger, nativeInteger, nativeBinary, nativeSize} from '@sharpforge/bytecode';

/** Reject mixing distinct CLI numeric categories while allowing native + Int32. */
export function nativeOperandBits(left, right, context, shift = false) {
  const first = isNativeInteger(left), second = isNativeInteger(right);
  const bits = first ? left.nativeInt : right.nativeInt;
  if (first && second && left.nativeInt !== right.nativeInt ||
      left?.float || right?.float || !first && typeof left === 'bigint' ||
      !second && typeof right === 'bigint' || shift && !first ||
      context.nativeIntBits !== undefined && bits !== nativeIntegerBits(context)) {
    const message = 'Mismatched native integer widths or numeric categories';
    throw context.fault ? context.fault('InvalidProgramException', message) :
      Object.assign(new Error(message), {name: 'InvalidProgramException'});
  }
  return bits;
}

export const isNativeStorageType = type => type === 'nint' || type === 'nuint' || type === 'System.IntPtr' || type === 'System.UIntPtr';

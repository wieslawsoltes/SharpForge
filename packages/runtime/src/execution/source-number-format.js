import {numericTypeName, number, nativeIntegerBits} from '@sharpforge/bytecode';
import {formatDoubleDefault, formatSingleDefault} from '@sharpforge/bcl-core';

/** Format stack bit patterns using declared signedness; return null for nonnumeric values. */
export function formatSourceNumber(vm, value, declaredType) {
  const type = numericTypeName(declaredType), raw = number(value);
  if (type === 'char') return String.fromCharCode(Number(raw));
  if (type === 'uint') return String(Number(raw) >>> 0);
  if (type === 'ulong') return String(BigInt.asUintN(64, BigInt(raw)));
  if (type === 'nuint') return String(BigInt.asUintN(nativeIntegerBits(vm.options), BigInt(raw)));
  if (typeof raw === 'bigint') return String(raw);
  if (typeof raw !== 'number') return null;
  return type === 'float' || value?.float === 'r4' ? formatSingleDefault(raw) : formatDoubleDefault(raw);
}

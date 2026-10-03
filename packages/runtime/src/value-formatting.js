import {nativeIntegerBits} from './execution/native-int.js';
import {formatDoubleDefault} from '@sharpforge/bcl-core';
import {isReference} from './heap.js';
import {enumToString} from './execution/enums.js';
import {runtimeTypeText} from './execution/tokens.js';

const boxedDisplayTypes = Object.freeze({
  'System.Boolean': 'bool',
  'System.Char': 'char',
  'System.UInt32': 'uint',
  'System.UInt64': 'ulong',
  'System.IntPtr': 'nint',
  'System.UIntPtr': 'nuint'
});

/** Preserve source managed-value display semantics, with invariant binary64 numeric text. */
export function formatSourceValue(vm, value) {
  const name = runtimeTypeText(vm, value) ?? enumToString(vm, value);
  if (name !== null) return name;
  if (value === null) return '';
  if (value === undefined) return '<unassigned>';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (isReference(value)) {
    const record = vm.heap.get(value);
    if (record.kind === 'string') return record.data;
    if (record.kind === 'exception') return record.type + ': ' + vm.format(record.data[0]);
    return record.type;
  }
  return typeof value === 'number' ? formatDoubleDefault(value) : String(value);
}

/** Preserve CIL boxing, enums and typed integer display before binary64 numeric formatting. */
export function formatCilValue(vm, value, type) {
  const name = runtimeTypeText(vm, value) ?? enumToString(vm, value, type);
  if (name !== null) return name;
  if (value === null) return '';
  if (isReference(value) && vm.heap.get(value).kind === 'box') {
    const record = vm.heap.get(value);
    return vm.format(record.data[0], boxedDisplayTypes[record.type]);
  }
  const native = vm.value(value);
  if (type === 'bool') return native ? 'True' : 'False';
  if (type === 'char') return String.fromCharCode(Number(native));
  if (type === 'nint' || type === 'System.IntPtr') return String(native);
  if (type === 'nuint' || type === 'System.UIntPtr') return String(BigInt.asUintN(nativeIntegerBits(vm.options), BigInt(native)));
  if (type === 'uint') return String(Number(native) >>> 0);
  if (type === 'ulong') return String(BigInt.asUintN(64, native));
  if (isReference(native)) {
    const record = vm.heap.get(native);
    return record.kind === 'exception' ? record.type + ': ' + vm.format(record.data[0]) : record.type;
  }
  return typeof native === 'number' ? formatDoubleDefault(native) : String(native);
}

import {isDecimal, decimalFormat} from './execution/decimal.js';
import {formatSourceNumber} from './execution/source-number-format.js';
import {nativeIntegerBits} from './execution/native-int.js';
import {isReference} from './heap.js';
import {enumToString} from './execution/enums.js';
import {runtimeTypeText} from './execution/tokens.js';

const boxedDisplayTypes = Object.freeze({
  'System.Boolean': 'bool',
  'System.Char': 'char',
  'System.UInt32': 'uint',
  'System.UInt64': 'ulong',
  'System.IntPtr': 'nint',
  'System.UIntPtr': 'nuint',
  'System.Single': 'float',
  'System.Double': 'double'
});

/** Preserve source managed-value display semantics, with invariant binary64 numeric text. */
export function formatSourceValue(vm, value, type) {
  if (isDecimal(value)) return decimalFormat(value);
  const name = runtimeTypeText(vm, value) ?? enumToString(vm, value);
  if (name !== null) return name;
  if (value === null) return '';
  if (value === undefined) return '<unassigned>';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (isReference(value)) {
    const record = vm.heap.get(value);
    if (record.kind === 'box') return vm.format(record.data[0], record.type);
    if (record.kind === 'string') return record.data;
    if (record.kind === 'exception') return record.type + ': ' + vm.format(record.data[0]);
    return record.type;
  }
  return formatSourceNumber(vm, value, type) ?? String(value);
}

/** Preserve CIL boxing, enums and typed integer display before binary64 numeric formatting. */
export function formatCilValue(vm, value, type) {
  if (isDecimal(value)) return decimalFormat(value);
  const name = runtimeTypeText(vm, value) ?? enumToString(vm, value, type);
  if (name !== null) return name;
  if (value === null) return '';
  if (isReference(value) && vm.heap.get(value).kind === 'box') {
    const record = vm.heap.get(value);
    return vm.format(record.data[0], boxedDisplayTypes[record.type] ?? record.type);
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
  return formatSourceNumber(vm, value, type) ?? String(native);
}

import {ManagedFault, isReference} from '../heap.js';
import {number, isNumber} from './numeric-ops.js';
import {referenceEquals} from './strings.js';
import {pointerType} from './managed-pointers.js';
import {runtimeTypeText} from './tokens.js';

function receiver(vm, value) {
  if (value === null) throw new ManagedFault('NullReferenceException', 'Object receiver is null');
  if (value?.byref) return {table: pointerType(vm, value), value: vm.dereference(value), reference: null};
  const record = vm.heap.get(value);
  return {table: record.methodTable, value: record.kind === 'box' ? record.data[0] : value, reference: value};
}

function equalValue(vm, left, right, depth = 0) {
  if (depth > 128) throw new ManagedFault('InvalidProgramException', 'Value equality nesting limit exceeded');
  if (left === right) return true;
  if (isReference(left) || isReference(right)) {
    if (!isReference(left) || !isReference(right)) return false;
    const a = vm.heap.get(left), b = vm.heap.get(right);
    if (a.kind === 'string' && b.kind === 'string') return vm.value(left) === vm.value(right);
    return referenceEquals(left, right);
  }
  if (left?.valueType || right?.valueType) {
    return left?.valueType === right?.valueType && left.fields.length === right.fields.length &&
      left.fields.every((value, index) => equalValue(vm, value, right.fields[index], depth + 1));
  }
  if (isNumber(left) && isNumber(right)) {
    const a = number(left), b = number(right);
    return a === b || typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  if (left?.decimal && right?.decimal) {
    const scale = Math.max(left.scale, right.scale);
    const a = left.coefficient * 10n ** BigInt(scale - left.scale) * (left.negative ? -1n : 1n);
    const b = right.coefficient * 10n ** BigInt(scale - right.scale) * (right.negative ? -1n : 1n);
    return a === b;
  }
  return false;
}

export function objectEquals(vm, left, right) {
  const a = receiver(vm, left);
  if (right === null || !isReference(right)) return false;
  const b = receiver(vm, right);
  if (a.table !== b.table) return false;
  return a.table.flags.valueType ? equalValue(vm, a.value, b.value) : equalValue(vm, left, right);
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash | 0;
}

function hashValue(vm, value, type = null, depth = 0) {
  if (depth > 128) throw new ManagedFault('InvalidProgramException', 'Value hash nesting limit exceeded');
  if (value === null) return 0;
  if (isReference(value)) {
    const record = vm.heap.get(value);
    return record.kind === 'string' ? hashText(vm.value(value)) : Math.imul(value.h + 1, 397) ^ value.g;
  }
  if (value?.valueType) {
    let hash = hashText(value.valueType.name);
    for (let index = 0; index < value.fields.length; index++) {
      hash = Math.imul(hash, 31) ^ hashValue(vm, value.fields[index], value.valueType.fields[index].type, depth + 1);
    }
    return hash | 0;
  }
  if (isNumber(value)) {
    const raw = number(value);
    if (typeof raw === 'bigint') return Number(BigInt.asIntN(32, raw ^ raw >> 32n));
    const name = type?.name ?? type;
    if (name === 'System.Char' || name === 'char') return raw | raw << 16;
    if (name === 'System.Single' || name === 'float') {
      if (Number.isNaN(raw)) return 0x7f800000;
      const bits = new DataView(new ArrayBuffer(4));
      bits.setFloat32(0, raw === 0 ? 0 : raw, true);
      return bits.getInt32(0, true);
    }
    if (Number.isNaN(raw)) return 0x7ff00000;
    if (raw === 0) return 0;
    if (!['System.Double', 'double'].includes(name) && Number.isInteger(raw) && raw >= -2147483648 && raw <= 2147483647) return raw | 0;
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, raw, true);
    return bits.getInt32(0, true) ^ bits.getInt32(4, true);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value?.decimal) {
    let coefficient = value.coefficient, scale = value.scale;
    while (scale && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
    const sign = coefficient !== 0n && value.negative ? 0x80000000 : 0;
    return Number(BigInt.asIntN(32, coefficient ^ coefficient >> 32n ^ coefficient >> 64n)) ^ scale << 16 ^ sign;
  }
  return 0;
}

/** Hashes preserve equality and snapshot stability; reference/type hash seeds are VM-specific. */
export function objectHashCode(vm, self) {
  const item = receiver(vm, self);
  return hashValue(vm, item.value, item.table);
}

export function objectToString(vm, self) {
  const item = receiver(vm, self);
  if (item.table.flags.valueType && !item.value?.valueType) return vm.heap.string(vm.format(item.value, item.table.name));
  return vm.heap.string(runtimeTypeText(vm, self) ?? (item.table.name === 'System.String' ? vm.value(self) : item.table.name));
}

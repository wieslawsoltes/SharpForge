import {ManagedFault, isReference} from '../heap.js';
import {number} from './numeric-ops.js';
import {decimalCompare, isDecimal} from './decimal.js';
import {executionCodeState} from './code-version.js';
import {ownsHeapReference} from './heap-reference.js';

export function objectValueRecord(vm, reference) {
  if (!ownsHeapReference(vm.heap, reference)) {
    throw new ManagedFault('InvalidProgramException', 'Object operation requires an owned managed reference');
  }
  return vm.heap.get(reference);
}

/** Primitive Equals treats all NaNs as equal and positive/negative zero as equal. */
export function scalarValueEquals(left, right) {
  if (isDecimal(left) || isDecimal(right)) {
    return isDecimal(left) && isDecimal(right) && decimalCompare(left, right) === 0;
  }
  const first = number(left), second = number(right);
  return first === second || typeof first === 'number' && typeof second === 'number' && Number.isNaN(first) && Number.isNaN(second);
}

/** The integer contracts are bit-exact; composite and string hashes promise equality consistency. */
export function integerHash(value) {
  return typeof value === 'bigint' ? Number(BigInt.asIntN(32, value ^ value >> 32n)) : Number(value) | 0;
}

export function stringHash(value) {
  let hash = -2128831035;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash | 0;
}

function decimalHash(value) {
  let coefficient = value.coefficient, scale = value.scale;
  while (scale && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  if (!coefficient) return 0;
  const bits = coefficient ^ coefficient >> 32n ^ coefficient >> 64n;
  return Number(BigInt.asIntN(32, bits)) ^ scale << 16 ^ (value.negative ? -2147483648 : 0);
}

export function scalarValueHash(vm, type, value) {
  if (isDecimal(value)) return decimalHash(value);
  const raw = number(value);
  if (typeof raw === 'boolean' && type?.name === 'System.Boolean') return Number(raw);
  if (value?.float || type?.name === 'System.Single' || type?.name === 'System.Double') {
    if (raw === 0) return 0;
    const state = executionCodeState(vm);
    const buffer = state.objectHashBuffer ??= new DataView(new ArrayBuffer(8));
    if (type?.name === 'System.Single' || value.float === 'r4') {
      if (Number.isNaN(raw)) return 0x7f800000;
      buffer.setFloat32(0, raw, true);
      return buffer.getInt32(0, true);
    }
    if (Number.isNaN(raw)) return 0x7ff00000;
    buffer.setFloat64(0, raw, true);
    return buffer.getInt32(0, true) ^ buffer.getInt32(4, true);
  }
  if (typeof raw !== 'number' && typeof raw !== 'bigint') {
    throw new ManagedFault('InvalidProgramException', 'Object value requires canonical scalar storage');
  }
  return integerHash(raw);
}

/** Reference identity uses owned, live heap handles; it never unboxes either operand. */
export function objectIdentityEquals(vm, left, right) {
  if (left !== null) objectValueRecord(vm, left);
  if (right !== null) objectValueRecord(vm, right);
  return left === right || isReference(left) && isReference(right) && left.h === right.h && left.g === right.g;
}

export function objectIdentityHash(vm, value) {
  objectValueRecord(vm, value);
  return Math.imul(value.h, 16777619) ^ value.g;
}

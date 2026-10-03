import {ManagedFault} from '../heap.js';
import {number} from './numeric-ops.js';
import {arrayElementBytes} from './array-storage.js';

/** Preserve exact Int64/native values until host addressing limits are checked. */
export function arrayInteger(value, error = 'IndexOutOfRangeException') {
  const raw = number(value);
  if (typeof raw === 'bigint') {
    if (raw < BigInt(Number.MIN_SAFE_INTEGER) || raw > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ManagedFault(error, 'Array integer exceeds the exact addressing range');
    }
    return Number(raw);
  }
  if (!Number.isSafeInteger(raw)) throw new ManagedFault(error, 'Array integer must be exact');
  return raw;
}

export function arrayAllocationLimit(vm, element) {
  const capacity = Math.floor(Math.max(0, vm.heap.maxBytes - 32) / arrayElementBytes(element));
  const configured = vm.options?.maxArrayLength ?? capacity;
  if (!Number.isSafeInteger(configured) || configured < 0) throw new RangeError('Invalid maxArrayLength');
  return Math.min(configured, capacity, 0xffffffff);
}

export function reserveArray(vm, element, length) {
  if (length < 0) throw new ManagedFault('OverflowException', 'Array length cannot be negative');
  if (!Number.isSafeInteger(length) || length > arrayAllocationLimit(vm, element)) {
    throw new ManagedFault('OutOfMemoryException', 'Array exceeds the configured heap capacity');
  }
  vm.heap.reserve(32 + length * arrayElementBytes(element));
}

import {ManagedFault} from '../heap.js';
import {arrayInteger} from './array-limits.js';

/** Validate readonly UTF-16 string interiors; no mutable character buffer is exposed. */
export function stringSpanLocation(vm, pointer, allowEnd = false) {
  if (!pointer?.byref || !Object.isFrozen(pointer) || pointer.kind !== 'string' ||
      pointer.vmOwner !== vm.snapshotOwner || pointer.readonly !== true ||
      !Array.isArray(pointer.path) || !Object.isFrozen(pointer.path) || pointer.path.length ||
      !Number.isSafeInteger(pointer.index) || pointer.index < 0 ||
      pointer.baseType !== vm.heap.methodTables.get('char')) {
    throw new ManagedFault('InvalidProgramException', 'Malformed readonly string address');
  }
  const record = vm.heap.get(pointer.owner);
  if (record.kind !== 'string' || pointer.index > record.data.length - (allowEnd ? 0 : 1)) {
    throw new ManagedFault('IndexOutOfRangeException', 'String address exceeds its storage');
  }
  return record;
}

export function stringSpanPointer(vm, reference, index) {
  const pointer = Object.freeze({byref: true, vmOwner: vm.snapshotOwner, kind: 'string', index, owner: reference,
    frameId: vm.top?.id, path: Object.freeze([]), readonly: true, baseType: vm.heap.methodTables.get('char')});
  stringSpanLocation(vm, pointer, true);
  return pointer;
}

export function stringSpanValue(vm, pointer, write = false) {
  const record = stringSpanLocation(vm, pointer);
  if (write) throw new ManagedFault('InvalidProgramException', 'String interiors are readonly');
  return record.data.charCodeAt(pointer.index);
}

/** Null strings produce empty readonly spans; non-null strings retain their original managed owner. */
export function spanFromString(vm, reference, start = 0, length = null) {
  const first = arrayInteger(start, 'ArgumentOutOfRangeException');
  const record = reference === null ? null : vm.heap.get(reference);
  if (record && record.kind !== 'string') throw new ManagedFault('ArgumentException', 'A string is required');
  const available = record?.data.length ?? 0;
  const count = length === null ? available - first : arrayInteger(length, 'ArgumentOutOfRangeException');
  if (first < 0 || count < 0 || first > available - count) throw new ManagedFault('ArgumentOutOfRangeException', 'Span exceeds string bounds');
  return Object.freeze({span: true, vmOwner: vm.snapshotOwner, elementType: vm.heap.methodTables.get('char'),
    pointer: reference === null ? null : stringSpanPointer(vm, reference, first), length: count, readonly: true});
}

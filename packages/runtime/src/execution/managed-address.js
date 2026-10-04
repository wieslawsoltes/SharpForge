import {ManagedFault} from '../gc/fault.js';
import {checkArrayStore} from './casting.js';
import {readCilArraySlot, writeCilArraySlot} from './cil-array-storage.js';
import {staticStorageType} from './storage.js';

const heapKinds = new Set(['box', 'field', 'array']);

/** Normalize declared storage, then publish through exactly one barrier for the address owner. */
export function dereference(vm, address, write = false, value) {
  if (!address?.byref) throw new ManagedFault('InvalidProgramException', 'A managed address is required');
  if (write && address.readOnly) throw new ManagedFault('InvalidOperationException', 'Cannot write through a readonly managed address');
  let slots;
  let storageType;
  let record;
  if (heapKinds.has(address.kind)) {
    record = address.kind === 'array' ? vm.indexed(address.owner, address.index) : vm.heap.get(address.owner);
    if (address.kind === 'box' && record.kind !== 'box') {
      throw new ManagedFault('InvalidProgramException', 'A boxed value address is required');
    }
    slots = record.data;
    storageType = address.kind === 'array' ? record.methodTable.elementType.name
      : address.kind === 'box' ? record.methodTable.name : record.methodTable.fields[address.index]?.type.name;
  } else if (address.kind === 'static') {
    if (!vm.statics.has(address.index)) throw new ManagedFault('InvalidProgramException', 'Unknown static slot');
    slots = vm.statics;
    if (write) storageType = staticStorageType(vm, address.index);
  } else {
    if (address.kind !== 'arg' && address.kind !== 'local') {
      throw new ManagedFault('InvalidProgramException', 'Unknown managed address');
    }
    const frame = vm.frames.find(candidate => candidate.id === address.frameId);
    if (!frame) throw new ManagedFault('InvalidProgramException', 'Managed address outlived its frame');
    slots = address.kind === 'arg' ? frame.args : frame.locals;
    storageType = vm.slotType(frame, address.kind === 'arg', address.index);
  }
  if (!(slots instanceof Map) && (!Number.isInteger(address.index) || address.index < 0 || address.index >= slots.length)) {
    throw new ManagedFault('InvalidProgramException', 'Invalid managed address slot');
  }
  const oldValue = address.kind === 'array' ? readCilArraySlot(vm.heap, record, address.index)
    : slots instanceof Map ? slots.get(address.index) : slots[address.index];
  if (!write) {
    if (oldValue === undefined) throw new ManagedFault('InvalidProgramException', 'Uninitialized address');
    return oldValue;
  }
  value = vm.storage(value, storageType);
  if (address.kind === 'array') {
    checkArrayStore(vm.heap, record, value);
    writeCilArraySlot(vm.heap, address.owner, address.index, value);
  } else if (heapKinds.has(address.kind)) vm.heap.writeField(address.owner, address.index, value);
  else if (address.kind === 'static') vm.heap.writeStatic(slots, address.index, value);
  else vm.heap.writeRoot(slots, address.index, value);
  vm.notifyWrite({kind: address.kind, index: address.index, frameId: address.frameId,
    ...(address.owner ? {handle: address.owner.h, generation: address.owner.g} : {}), oldValue, value});
  return value;
}

export {dereference as dereferenceManagedAddress};

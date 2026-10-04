import {ManagedFault} from '../heap.js';
import {checkArrayStore} from './casting.js';
import {staticStorageType} from './storage.js';

/** Read or write a CIL managed address, preserving declared storage and write notifications. */
export function dereferenceManagedAddress(vm, address, write = false, value) {
  if (!address?.byref) throw new ManagedFault('InvalidProgramException', 'A managed address is required');
  let slots;
  let storageType;
  if (address.kind === 'box' || address.kind === 'field' || address.kind === 'array') {
    const record = address.kind === 'array'
      ? vm.indexed(address.owner, address.index)
      : vm.heap.get(address.owner);
    if (address.kind === 'box' && record.kind !== 'box') {
      throw new ManagedFault('InvalidProgramException', 'A boxed value address is required');
    }
    slots = record.data;
    storageType = address.kind === 'array' ? record.methodTable.elementType.name
      : address.kind === 'box' ? record.methodTable.name : record.methodTable.fields[address.index]?.type.name;
  } else if (address.kind === 'static') {
    if (!vm.statics.has(address.index)) throw new ManagedFault('InvalidProgramException', 'Unknown static slot');
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
  if (slots && (!Number.isInteger(address.index) || address.index < 0 || address.index >= slots.length)) {
    throw new ManagedFault('InvalidProgramException', 'Invalid managed address slot');
  }
  const oldValue = slots ? slots[address.index] : vm.statics.get(address.index);
  if (write) {
    value = vm.storage(value, storageType);
    if (address.kind === 'array') checkArrayStore(vm.heap, vm.heap.get(address.owner), value);
    if (slots) slots[address.index] = value;
    else vm.statics.set(address.index, value);
    vm.writeRevision++;
    if (address.owner) vm.heap.mutationRevision++;
    vm.onWrite?.({
      kind: address.kind,
      index: address.index,
      frameId: address.frameId,
      ...(address.owner ? {handle: address.owner.h, generation: address.owner.g} : {}),
      oldValue,
      value,
    });
    return value;
  }
  if (oldValue === undefined) throw new ManagedFault('InvalidProgramException', 'Uninitialized address');
  return oldValue;
}

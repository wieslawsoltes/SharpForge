import {ManagedFault} from '../heap.js';
import {checkArrayStore} from './casting.js';
import {staticStorageType} from './storage.js';
import {isValueRecord, replaceValueField} from './value-types.js';
import {instancePointerLocalPlan, instancePointerLocalValue} from './instance-pointer-locals.js';

const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

function location(vm, address, write = false) {
  if (!address?.byref) invalid('A managed address is required');
  let slots;
  let storageType;
  let frame;
  if (address.kind === 'box' || address.kind === 'field' || address.kind === 'array') {
    const record = address.kind === 'array' ? vm.indexed(address.owner, address.index) : vm.heap.get(address.owner);
    if (address.kind === 'box' && record.kind !== 'box') invalid('A boxed value address is required');
    slots = record.data;
    storageType = address.kind === 'array' ? record.methodTable.elementType.name
      : address.kind === 'box' ? record.methodTable.name
        : record.methodTable.fields[address.index]?.storageType ?? record.methodTable.fields[address.index]?.type.name;
  } else if (address.kind === 'static') {
    if (!vm.statics.has(address.index)) invalid('Unknown static slot');
    storageType = staticStorageType(vm, address.index, write);
  } else {
    if (address.kind !== 'arg' && address.kind !== 'local') invalid('Unknown managed address');
    frame = vm.allFrames().find(candidate => candidate.id === address.frameId);
    if (!frame) invalid('Managed address outlived its frame');
    slots = address.kind === 'arg' ? frame.args : frame.locals;
    storageType = vm.slotType(frame, address.kind === 'arg', address.index);
  }
  if (address.vmOwner !== vm.snapshotOwner) invalid('Managed address belongs to another VM or has no owner');
  if (!Array.isArray(address.path) || !Object.isFrozen(address.path) || address.path.length > 128) invalid('Invalid managed address path');
  if (slots && (!Number.isInteger(address.index) || address.index < 0 || address.index >= slots.length)) {
    invalid('Invalid managed address slot');
  }
  return {slots, storageType, frame};
}

function leaf(vm, address, base) {
  let value = base.slots ? base.slots[address.index] : vm.statics.get(address.index);
  let type = base.storageType;
  let readonly = !!address.readonly;
  for (const index of address.path) {
    if (!isValueRecord(value) || value.valueType.registry !== vm.heap.methodTables ||
        !Number.isInteger(index) || index < 0 || index >= value.fields.length) invalid('Invalid struct interior address');
    const field = value.valueType.fields[index];
    readonly ||= !!(field.flags & 0x20);
    type = field.storageType ?? field.type.name;
    value = value.fields[index];
  }
  return {value, type, readonly};
}

/** Inspect owned storage without reading an uninitialized value; constructors still validate its declared type. */
export function inspectManagedAddress(vm, address) {
  return leaf(vm, address, location(vm, address));
}

/** Store a location and immutable field path, never a direct alias to frame or struct storage. */
export function createManagedAddress(vm, kind, index, owner) {
  if (owner?.byref) {
    if (kind !== 'field') invalid('Only fields can extend an interior address');
    location(vm, owner);
    const address = Object.freeze({...owner, path: Object.freeze([...owner.path, index])});
    leaf(vm, address, location(vm, address));
    return address;
  }
  return Object.freeze({byref: true, vmOwner: vm.snapshotOwner, kind, index, owner,
    frameId: vm.top?.id ?? 0, path: Object.freeze([])});
}

function replace(vm, value, path, position, replacement) {
  if (position === path.length) return replacement;
  const index = path[position];
  return replaceValueField(vm, value, index, replace(vm, value.fields[index], path, position + 1, replacement));
}

/** Resolve interior paths afresh so replacing an enclosing value never redirects a live field address. */
export function dereferenceManagedAddress(vm, address, write = false, value) {
  const base = location(vm, address, write), current = leaf(vm, address, base);
  if (!write) {
    if (current.value === undefined) invalid('Uninitialized address');
    return current.value;
  }
  if (current.readonly) invalid('Cannot write through a readonly managed address');
  const pointer = address.kind === 'local' && !address.path.length && instancePointerLocalPlan(vm, base.frame, address.index);
  value = pointer ? instancePointerLocalValue(vm, value, pointer) : vm.storage(value, current.type);
  if (value?.byref && !['arg', 'local'].includes(address.kind)) invalid('Managed addresses cannot escape into aggregate storage');
  if (address.kind === 'array' && !address.path.length) checkArrayStore(vm.heap, vm.heap.get(address.owner), value);
  const original = base.slots ? base.slots[address.index] : vm.statics.get(address.index);
  const replacement = replace(vm, original, address.path, 0, value);
  if (base.slots) base.slots[address.index] = replacement;
  else vm.statics.set(address.index, replacement);
  vm.writeRevision++;
  if (address.owner) vm.heap.mutationRevision++;
  vm.onWrite?.({kind: address.kind, index: address.index, frameId: address.frameId,
    ...(address.owner ? {handle: address.owner.h, generation: address.owner.g} : {}),
    ...(address.path.length ? {path: address.path} : {}), oldValue: current.value, value});
  return value;
}

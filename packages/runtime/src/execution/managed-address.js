import {ManagedFault} from '../heap.js';
import {checkArrayStore} from './casting.js';
import {staticStorageType} from './storage.js';
import {isValueRecord, replaceValueField} from './value-types.js';
import {instancePointerLocalPlan, instancePointerLocalValue} from './instance-pointer-locals.js';
import {frameById} from './frame-lifetimes.js';
import {storageRead, storageWrite} from './array-storage.js';
import {captureFrameSlot} from './frame-root-liveness.js';
import {readMemory, writeMemory, pointerOffset} from './raw-memory.js';
import {valueLayout} from './value-layout.js';
import {storePinnedLocal} from './pinned.js';
import {stringSpanValue} from './string-span.js';
import {NullableValueStep, requireNullableInterior, replaceNullableInterior} from './nullable-interior.js';

const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

function location(vm, address, write = false) {
  if (!address?.byref) invalid('A managed address is required');
  if (address.vmOwner !== vm.snapshotOwner) invalid('Managed address belongs to another VM or has no owner');
  let slots;
  let storageType;
  let frame;
  let element;
  if (address.kind === 'box' || address.kind === 'field' || address.kind === 'array') {
    const record = write ? vm.heap.ensureWritable(address.owner) : vm.heap.get(address.owner);
    if (address.kind === 'box' && record.kind !== 'box') invalid('A boxed value address is required');
    if (address.kind === 'array' && record.kind !== 'array') invalid('An array element address is required');
    slots = record.data;
    element = address.kind === 'array' ? record.methodTable.elementType : null;
    storageType = address.kind === 'array' ? record.methodTable.elementType.name
      : address.kind === 'box' ? record.methodTable.name
        : record.methodTable.fields[address.index]?.storageType ?? record.methodTable.fields[address.index]?.type.name;
  } else if (address.kind === 'static') {
    if (!vm.statics.has(address.index)) invalid('Unknown static slot');
    storageType = staticStorageType(vm, address.index, write);
  } else {
    if (address.kind !== 'arg' && address.kind !== 'local') invalid('Unknown managed address');
    frame = frameById(vm, address.frameId);
    slots = address.kind === 'arg' ? frame.args : frame.locals;
    storageType = vm.slotType(frame, address.kind === 'arg', address.index);
  }
  if (!Array.isArray(address.path) || !Object.isFrozen(address.path) || address.path.length > 128) invalid('Invalid managed address path');
  if (slots && (!Number.isInteger(address.index) || address.index < 0 || address.index >= slots.length)) {
    invalid('Invalid managed address slot');
  }
  return {slots, storageType, frame, element};
}

function leaf(vm, address, base) {
  let value = base.element ? storageRead(base.slots, address.index, base.element, {source: !vm.inspector})
    : base.slots ? base.slots[address.index] : vm.statics.get(address.index);
  let type = base.storageType;
  let readonly = !!address.readonly;
  for (const index of address.path) {
    if (index === NullableValueStep) {
      type = requireNullableInterior(vm, value, type).name;
      value = value.value;
      continue;
    }
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
  if (address?.kind === 'string') return {value: stringSpanValue(vm, address), type: 'char', readonly: true};
  if (address?.memoryPointer) return {value: readMemory(vm, address), type: address.baseType.name, readonly: !!address.readonly};
  return leaf(vm, address, location(vm, address));
}

/** Store a location and immutable field path, never a direct alias to frame or struct storage. */
export function createManagedAddress(vm, kind, index, owner, options = {}) {
  if (owner?.byref) {
    if (kind !== 'field') invalid('Only fields can extend an interior address');
    if (owner.memoryPointer) {
      const field = owner.baseType.fields[index];
      if (!field) invalid('Invalid raw struct field');
      return pointerOffset(vm, owner, valueLayout(vm, owner.baseType).offsets[index], field.type);
    }
    location(vm, owner);
    const address = Object.freeze({...owner, path: Object.freeze([...owner.path, index])});
    leaf(vm, address, location(vm, address));
    return address;
  }
  if (kind === 'arg' || kind === 'local') captureFrameSlot(frameById(vm, options.frameId ?? vm.top?.id), kind, index);
  return Object.freeze({byref: true, vmOwner: vm.snapshotOwner, kind, index, owner,
    frameId: options.frameId ?? vm.top?.id, path: Object.freeze([]),
    ...(options.readonly ? {readonly: true} : {}), ...(options.type ? {baseType: vm.heap.methodTables.get(options.type)} : {})});
}

function replace(vm, value, path, position, replacement) {
  if (position === path.length) return replacement;
  const index = path[position];
  if (index === NullableValueStep) {
    return replaceNullableInterior(vm, value, replace(vm, value.value, path, position + 1, replacement));
  }
  return replaceValueField(vm, value, index, replace(vm, value.fields[index], path, position + 1, replacement));
}

/** Resolve interior paths afresh so replacing an enclosing value never redirects a live field address. */
export function dereferenceManagedAddress(vm, address, write = false, value) {
  if (address?.kind === 'string') return stringSpanValue(vm, address, write);
  if (address?.memoryPointer) return write ? writeMemory(vm, address, value) : readMemory(vm, address);
  const base = location(vm, address, write), current = leaf(vm, address, base);
  if (!write) {
    if (current.value === undefined) invalid('Uninitialized address');
    return current.value;
  }
  if (current.readonly) invalid('Cannot write through a readonly managed address');
  const pointer = address.kind === 'local' && !address.path.length && instancePointerLocalPlan(vm, base.frame, address.index);
  const pinned = address.kind === 'local' && !address.path.length && current.type.endsWith(' pinned');
  value = pinned ? storePinnedLocal(vm, base.frame, address.index, value)
    : pointer ? instancePointerLocalValue(vm, value, pointer) : vm.storage(value, current.type);
  if ((value?.byref || value?.span) && !['arg', 'local'].includes(address.kind)) {
    invalid('Managed addresses cannot escape into aggregate storage');
  }
  if (address.kind === 'array' && !address.path.length) checkArrayStore(vm.heap, vm.heap.get(address.owner), value);
  const original = base.slots ? base.slots[address.index] : vm.statics.get(address.index);
  const replacement = replace(vm, original, address.path, 0, value);
  if (base.element) storageWrite(base.slots, address.index, replacement);
  else if (base.slots) base.slots[address.index] = replacement;
  else vm.statics.set(address.index, replacement);
  vm.writeRevision++;
  if (address.owner) vm.heap.mutationRevision++;
  vm.onWrite?.({kind: address.kind, index: address.index, frameId: address.frameId,
    ...(address.owner ? {handle: address.owner.h, generation: address.owner.g} : {}),
    ...(address.path.length ? {path: address.path} : {}), oldValue: current.value, value});
  return value;
}

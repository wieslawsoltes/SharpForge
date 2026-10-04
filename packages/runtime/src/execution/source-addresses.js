import {
  readMemory,
  writeMemory,
  validateMemoryPointer,
  pointerOffset
} from './raw-memory.js';
import {
  valueLayout
} from './value-layout.js';
import {
  NullableValueStep,
  requireNullableInterior,
  replaceNullableInterior
} from './nullable-interior.js';
import {
  stringSpanValue,
  stringSpanLocation
} from './string-span.js';
import {
  ManagedFault
} from '../heap.js';
import {
  frameById
} from './frame-lifetimes.js';
import {
  captureFrameSlot
} from './frame-root-liveness.js';
import {
  sourceStore
} from './source-storage.js';
import {
  isValueRecord,
  replaceValueField
} from './value-types.js';
import {
  checkArrayStore
} from './casting.js';
import {
  isArrayStorage,
  storageRead,
  storageWrite
} from './array-storage.js';

const invalid = message => {
  throw new ManagedFault('InvalidProgramException', message);
};

function storageLocation(vm, pointer) {
  if (!pointer?.byref || pointer.vmOwner !== vm.snapshotOwner || !Object.isFrozen(pointer) ||
    !Array.isArray(pointer.path) || !Object.isFrozen(pointer.path) || pointer.path.length > 128) {
    invalid('Invalid source managed address');
  }
  let slots, type, record = null,
    element = null;
  if (pointer.kind === 'local' || pointer.kind === 'arg') {
    const frame = frameById(vm, pointer.frameId);
    if (!frame) invalid('Managed address outlived its frame');
    slots = frame.locals;
    type = vm.image.methods[frame.methodId]?.locals[pointer.index]?.type ??
      frame.varargs?.find(item => item.index === pointer.index)?.type?.name;
  } else if (pointer.kind === 'static') {
    slots = vm.statics;
    type = vm.image.statics[pointer.index]?.type;
  } else if (['field', 'array', 'box'].includes(pointer.kind)) {
    record = vm.heap.get(pointer.owner);
    if (pointer.kind === 'array' && record.kind !== 'array') invalid('An array element address is required');
    if (pointer.kind === 'box' && record.kind !== 'box') invalid('A boxed value address is required');
    slots = record.data;
    if (pointer.kind === 'array') element = record.methodTable.elementType;
    type = pointer.kind === 'array' ? record.methodTable.elementType.name : pointer.kind === 'box' ? record.type :
      record.methodTable.fields[pointer.index]?.storageType ?? record.methodTable.fields[pointer.index]?.type.name;
  } else invalid('Unknown source managed address kind');
  if (!isArrayStorage(slots) || !Number.isInteger(pointer.index) || !type) {
    invalid('Invalid source managed storage slot');
  }
  if (pointer.index < 0 || pointer.index >= slots.length) {
    if (pointer.kind === 'array') throw new ManagedFault('IndexOutOfRangeException', 'Array index is outside its bounds');
    invalid('Invalid source managed storage slot');
  }
  return {
    slots,
    type,
    element,
    record
  };
}

function leaf(vm, pointer, location) {
  let value = storageRead(location.slots, pointer.index, location.element, {
    source: true
  });
  let type = location.type,
    readonly = !!pointer.readonly;
  for (const index of pointer.path) {
    if (index === NullableValueStep) {
      type = requireNullableInterior(vm, value, type).name;
      value = value.value;
      continue;
    }
    if (!isValueRecord(value) || value.valueType.registry !== vm.heap.methodTables ||
      !Number.isInteger(index) || index < 0 || index >= value.fields.length) invalid('Invalid struct interior address');
    const field = value.valueType.fields[index];
    type = field.storageType ?? field.type.name;
    readonly ||= !!(field.flags & 0x20);
    value = value.fields[index];
  }
  return {
    value,
    type,
    readonly
  };
}

/** Source byrefs share the owned immutable location ABI used by CIL and snapshots. */
export function sourceAddress(vm, kind, index, owner = null, options = {}) {
  if (owner?.memoryPointer) {
    if (kind !== 'field') invalid('Only fields can extend an interior address');
    const field = owner.baseType?.fields[index];
    if (!field) invalid('Invalid raw struct field');
    const pointer = pointerOffset(vm, owner, valueLayout(vm, owner.baseType).offsets[index], field.type);
    return options.readonly || field.flags & 0x20 ? readonlySourceAddress(vm, pointer) : pointer;
  }
  if (owner?.byref) {
    if (kind !== 'field') invalid('Only fields can extend an interior address');
    const receiver = inspectSourceAddress(vm, owner);
    // A ref class slot names a reference, not inline struct storage. Field identity
    // belongs to that object even if the original reference slot is later reassigned.
    if (!vm.heap.methodTables.get(receiver.type).flags.valueType) owner = receiver.value;
  }
  const pointer = owner?.byref ? Object.freeze({
      ...owner,
      readonly: !!(owner.readonly || options.readonly),
      path: Object.freeze([...owner.path, index])
    }) :
    Object.freeze({
      byref: true,
      vmOwner: vm.snapshotOwner,
      kind,
      index,
      owner,
      frameId: options.frameId ?? vm.top?.id ?? 0,
      path: Object.freeze([]),
      readonly: !!options.readonly
    });
  const current = inspectSourceAddress(vm, pointer);
  if (pointer.kind === 'arg' || pointer.kind === 'local') {
    captureFrameSlot(frameById(vm, pointer.frameId), 'local', pointer.index);
  }
  if (options.type && vm.heap.methodTables.get(options.type) !== vm.heap.methodTables.get(current.type)) {
    invalid('Managed address type mismatch');
  }
  return pointer;
}

export function inspectSourceAddress(vm, pointer) {
  if (pointer?.memoryPointer) {
    validateMemoryPointer(vm, pointer);
    return {
      type: pointer.baseType.name,
      readonly: pointer.readonly
    };
  }
  if (pointer?.kind === 'string') {
    stringSpanLocation(vm, pointer, true);
    return {
      type: 'char',
      readonly: true
    };
  }
  return leaf(vm, pointer, storageLocation(vm, pointer));
}

/** A readonly view retains its exact owner and lifetime; it never names the pointer's storage slot. */
export function readonlySourceAddress(vm, pointer) {
  inspectSourceAddress(vm, pointer);
  return pointer.readonly ? pointer : Object.freeze({
    ...pointer,
    readonly: true
  });
}

function replace(vm, value, path, position, replacement) {
  if (position === path.length) return replacement;
  const index = path[position];
  if (index === NullableValueStep) {
    return replaceNullableInterior(vm, value, replace(vm, value.value, path, position + 1, replacement));
  }
  return replaceValueField(vm, value, index, replace(vm, value.fields[index], path, position + 1, replacement));
}

export function sourceStorage(vm, value, type) {
  return sourceStore(vm, value, type);
}

/** Resolve storage afresh so replacing enclosing structs cannot redirect their interior pointers. */
export function sourceDereference(vm, pointer, write = false, value) {
  if (pointer?.memoryPointer) return write ? writeMemory(vm, pointer, value) : readMemory(vm, pointer);
  if (pointer?.kind === 'string') return stringSpanValue(vm, pointer, write);
  const location = storageLocation(vm, pointer),
    current = leaf(vm, pointer, location);
  if (!write) {
    if (current.value === undefined) invalid('Uninitialized address');
    return current.value;
  }
  if (current.readonly) invalid('Cannot write through a readonly managed address');
  const pinCount = vm.heap.pins.length;
  vm.heap.pins.push(pointer, value);
  try {
    value = sourceStorage(vm, value, current.type);
  } finally {
    vm.heap.pins.length = pinCount;
  }
  if ((value?.byref || value?.span || value?.typedReference) && !['local', 'arg'].includes(pointer.kind)) invalid(
    'Managed addresses cannot escape into aggregate storage');
  if (pointer.kind === 'array' && !pointer.path.length) checkArrayStore(vm.heap, vm.heap.get(pointer.owner), value);
  const slots = location.record ? vm.heap.ensureWritable(pointer.owner).data : location.slots;
  const original = storageRead(slots, pointer.index, location.element, {
    source: true
  });
  storageWrite(slots, pointer.index, replace(vm, original, pointer.path, 0, value));
  if (pointer.kind === 'box') vm.heap.mutationRevision++;
  vm.notifyWrite({
    kind: pointer.kind,
    index: pointer.index,
    frameId: pointer.frameId,
    ...(pointer.owner ? {
      handle: pointer.owner.h,
      generation: pointer.owner.g
    } : {}),
    ...(pointer.path.length ? {
      path: pointer.path
    } : {}),
    oldValue: current.value,
    value
  });
  return value;
}

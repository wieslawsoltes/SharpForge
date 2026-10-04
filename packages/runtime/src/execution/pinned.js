import {ManagedFault,isReference} from '../heap.js';
import {frameById} from './frame-lifetimes.js';
import {memoryPointer, stackRegion, nextMemoryId} from './stack-memory.js';
import {arrayElementBytes, rawArrayBytes} from './array-storage.js';
import {ownsHeapReference} from './heap-reference.js';

function releaseLease(vm, frame, localIndex) {
  const lease = frame.pinLeases?.get(localIndex);
  if (!lease) return;
  lease.active = false;
  vm.heap.releaseHandle(lease.handle);
  frame.pinLeases.delete(localIndex);
}

/** A pinned local owns a scoped strong handle. Clearing it revokes derived pointers. */
export function storePinnedLocal(vm, frame, localIndex, value) {
  if (value === null || value === 0 || value === 0n || value?.nativeInt && (value.value === 0 || value.value === 0n)) {
    releaseLease(vm, frame, localIndex);
    return null;
  }
  if (value?.memoryPointer && value.kind === 'stack') {
    if (value.vmOwner !== vm.snapshotOwner) throw new ManagedFault('InvalidProgramException', 'Foreign pinned address');
    stackRegion(vm, value);
    releaseLease(vm, frame, localIndex);
    return value;
  }
  const reference = isReference(value) ? value : value?.owner;
  if (!isReference(value) && (!value?.byref || !Object.isFrozen(value) || value.kind !== 'array' ||
      !Array.isArray(value.path) || value.path.length || !Object.isFrozen(value.path))) {
    throw new ManagedFault('NotSupportedException', 'Pinned locals require a primitive array element address');
  }
  if (value?.byref && value.vmOwner !== vm.snapshotOwner || !ownsHeapReference(vm.heap, reference)) {
    throw new ManagedFault('InvalidProgramException', 'Foreign pinned address');
  }
  const record = vm.heap.get(reference);
  if (value?.byref && (!Number.isSafeInteger(value.index) || value.index < 0 || value.index >= record.data.length)) {
    throw new ManagedFault('IndexOutOfRangeException', 'Pinned array address exceeds its allocation');
  }
  try {rawArrayBytes(record.data);}
  catch {throw new ManagedFault('NotSupportedException','Pinned storage cannot contain managed references');}
  frameById(vm, frame.id);
  const id = nextMemoryId(vm);
  const handle = vm.heap.createHandle(reference);
  releaseLease(vm, frame, localIndex);
  frame.pinLeases ??= new Map();
  frame.pinLeases.set(localIndex, {id, active: true, owner: reference, handle});
  if(isReference(value))return value;
  return memoryPointer(vm, {
    kind: 'pinned', frameId: frame.id, leaseId: id, localIndex, owner: value.owner,
    index: value.index * arrayElementBytes(record.methodTable.elementType), baseType: record.methodTable.elementType
  });
}

export function pinnedRecord(vm, pointer) {
  const frame = frameById(vm, pointer.frameId);
  const lease = frame.pinLeases?.get(pointer.localIndex);
  if (!lease?.active || lease.id !== pointer.leaseId || vm.heap.getHandle(lease.handle) === null) {
    throw new ManagedFault('InvalidProgramException', 'Native pointer outlived its pin');
  }
  if (lease.owner.h !== pointer.owner?.h || lease.owner.g !== pointer.owner?.g) {
    throw new ManagedFault('InvalidProgramException', 'Pinned pointer has the wrong owner');
  }
  return vm.heap.get(lease.owner);
}

export function livePinCount(vm) {
  let count = 0;
  for (const frame of vm.allFrames()) count += frame.pinLeases?.size ?? 0;
  return count;
}

/** conv.u of a managed array interior resolves the active lexical pin lease. */
export function pinnedAddress(vm, value) {
  if(value?.memoryPointer)return value;
  if (!value?.byref || !Object.isFrozen(value) || value.kind !== 'array' || value.vmOwner !== vm.snapshotOwner ||
      !Array.isArray(value.path) || value.path.length || !Object.isFrozen(value.path)) {
    throw new ManagedFault('InvalidProgramException','Pointer conversion requires a pinned array interior');
  }
  for(const frame of vm.allFrames())for(const [localIndex,lease] of frame.pinLeases??[]) {
    if(!lease.active||lease.owner.h!==value.owner.h||lease.owner.g!==value.owner.g)continue;
    const record=vm.heap.get(lease.owner);
    if (!Number.isSafeInteger(value.index) || value.index < 0 || value.index >= record.data.length) {
      throw new ManagedFault('IndexOutOfRangeException', 'Pinned array address exceeds its allocation');
    }
    return memoryPointer(vm, {
      kind:'pinned',frameId:frame.id,leaseId:lease.id,localIndex,owner:lease.owner,
      index:value.index*arrayElementBytes(record.methodTable.elementType),baseType:record.methodTable.elementType
    });
  }
  throw new ManagedFault('InvalidProgramException','Managed pointer has no live pin');
}

import {ManagedFault,isReference} from '../heap.js';
import {frameById, registerFrame} from './frame-lifetimes.js';
import {memoryPointer} from './stack-memory.js';
import {arrayElementBytes, rawArrayBytes} from './array-storage.js';

function releaseLease(vm, frame, localIndex) {
  const lease = frame.pinLeases?.get(localIndex);
  if (!lease) return;
  lease.active = false;
  vm.heap.releaseHandle(lease.handle);
  frame.pinLeases.delete(localIndex);
}

/** A pinned local owns a scoped strong handle. Clearing it revokes derived pointers. */
export function storePinnedLocal(vm, frame, localIndex, value) {
  releaseLease(vm, frame, localIndex);
  if (value === null || value === 0 || value === 0n) return null;
  const reference=isReference(value)?value:value?.owner;
  if (!isReference(value)&&(!value?.byref || value.kind !== 'array' || value.path.length)) {
    throw new ManagedFault('NotSupportedException', 'Pinned locals require a primitive array element address');
  }
  if (value?.byref&&value.vmOwner !== vm.snapshotOwner) throw new ManagedFault('InvalidProgramException', 'Foreign pinned address');
  const record = vm.heap.get(reference);
  rawArrayBytes(record.data);
  registerFrame(vm, frame);
  vm.memorySequence = (vm.memorySequence ?? 0) + 1;
  const id = vm.memorySequence;
  const handle = vm.heap.createHandle(reference);
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
  for (const frame of vm.frameIndex?.values() ?? []) count += frame.pinLeases?.size ?? 0;
  return count;
}

/** conv.u of a managed array interior resolves the active lexical pin lease. */
export function pinnedAddress(vm, value) {
  if(value?.memoryPointer)return value;
  if(value?.kind!=='array'||value.vmOwner!==vm.snapshotOwner||value.path.length) {
    throw new ManagedFault('InvalidProgramException','Pointer conversion requires a pinned array interior');
  }
  for(const frame of vm.frameIndex?.values()??[])for(const [localIndex,lease] of frame.pinLeases??[]) {
    if(!lease.active||lease.owner.h!==value.owner.h||lease.owner.g!==value.owner.g)continue;
    const record=vm.heap.get(lease.owner);
    return memoryPointer(vm, {
      kind:'pinned',frameId:frame.id,leaseId:lease.id,localIndex,owner:lease.owner,
      index:value.index*arrayElementBytes(record.methodTable.elementType),baseType:record.methodTable.elementType
    });
  }
  throw new ManagedFault('InvalidProgramException','Managed pointer has no live pin');
}

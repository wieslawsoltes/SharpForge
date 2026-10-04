import {ManagedFault} from '../heap.js';
import {frameById} from './frame-lifetimes.js';
import {arrayInteger} from './array-limits.js';

/** Allocate zeroed frame-owned bytes. No host pointer or buffer escapes this API. */
export function stackAllocate(vm, byteLength) {
  const length = arrayInteger(byteLength, 'OverflowException');
  if (length < 0) throw new ManagedFault('OverflowException', 'Stack allocation length cannot be negative');
  const frame = vm.top?.filterOwnerId ? frameById(vm, vm.top.filterOwnerId) : vm.top;
  if (!frame) throw new ManagedFault('InvalidProgramException', 'Stack allocation requires a live frame');
  frameById(vm, frame.id);
  const limit = vm.options?.maxStackMemoryBytes ?? 1024 * 1024;
  let allocated = 0;
  for (const live of vm.allFrames()) {
    for (const region of live.stackRegions?.values() ?? []) allocated += region.bytes.byteLength;
  }
  if (!Number.isSafeInteger(limit) || length > limit - allocated) {
    const fault = new ManagedFault('StackOverflowException', 'Stack memory budget exhausted');
    fault.fatal = true;
    throw fault;
  }
  const regionId = nextMemoryId(vm);
  frame.stackRegions ??= new Map();
  frame.stackRegions.set(regionId, {bytes: new Uint8Array(length)});
  return memoryPointer(vm, {
    kind: 'stack', frameId: frame.id, regionId, index: 0, owner: null,
    baseType: vm.heap.methodTables.get('byte')
  });
}

export function nextMemoryId(vm) {
  const next = (vm.memorySequence ?? 0) + 1;
  if (!Number.isSafeInteger(next)) throw new ManagedFault('InvalidProgramException', 'Memory identity exhausted');
  return vm.memorySequence = next;
}

export function memoryPointer(vm, location) {
  return Object.freeze({
    byref: true, memoryPointer: true, vmOwner: vm.snapshotOwner, path: Object.freeze([]), readonly: false,
    ...location
  });
}

export function stackRegion(vm, pointer) {
  const region = frameById(vm, pointer.frameId).stackRegions?.get(pointer.regionId);
  if (!region) throw new ManagedFault('InvalidProgramException', 'Stack address outlived its allocation');
  return region;
}

export {releaseFrameMemory} from './frame-memory-release.js';

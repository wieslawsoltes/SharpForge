import {ManagedFault} from '../heap.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Register a live frame once. Parked frames retain the same identity and leases. */
export function registerFrame(vm, frame) {
  vm.frameIndex ??= new Map();
  const existing = vm.frameIndex.get(frame.id);
  if (existing && existing !== frame) throw new ManagedFault('InvalidProgramException', 'Duplicate live frame identity');
  vm.frameIndex.set(frame.id, frame);
  return frame;
}

export function frameById(vm, id) {
  if (!vm.frameIndex) rebuildFrameIndex(vm);
  const frame = vm.frameIndex.get(id);
  if (!frame) throw new ManagedFault('InvalidProgramException', 'Managed address outlived its frame');
  return frame;
}

/** Called only on final exit, never when an execution context is parked. */
export function releaseFrame(vm, frame) {
  vm.frameIndex?.delete(frame.id);
  if (frame.filterOwnerId !== undefined && frame.filterOwnerId !== frame.id) return;
  for (const lease of frame.pinLeases?.values() ?? []) {
    if (lease.handle) vm.heap.releaseHandle(lease.handle);
    lease.active = false;
  }
  frame.pinLeases?.clear();
  frame.stackRegions?.clear();
}

/** The index is derived state: rebuild after restore, retaining captured regions. */
export function rebuildFrameIndex(vm) {
  vm.frameIndex = new Map();
  for (const frame of vm.frames) registerFrame(vm, frame);
  for (const context of vm.scheduler?.contexts?.values() ?? []) {
    if (terminal.has(context.status) && !context.preserveFrames || context.id === vm.scheduler.currentId && !vm.scheduler.parked) continue;
    for (const frame of context.frames) registerFrame(vm, frame);
  }
  return vm.frameIndex;
}

export function releaseAllFrames(vm) {
  if (!vm.frameIndex) rebuildFrameIndex(vm);
  for (const frame of [...vm.frameIndex.values()]) releaseFrame(vm, frame);
}

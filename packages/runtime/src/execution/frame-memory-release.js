/** Revoke frame-owned capabilities at logical retirement, before pooled storage is cleared. */
export function releaseFrameMemory(vm, frame) {
  frame.stackRegions?.clear();
  const leases = frame.pinLeases?.values();
  if (leases != null) {
    for (const lease of leases) {
      lease.active = false;
      vm.heap.releaseHandle(lease.handle);
    }
  }
  frame.pinLeases?.clear();
}

/** Successful restore abandons the old frame graph after preflight and before heap replacement. */
export function releaseVMFrameMemory(vm) {
  for (const frame of vm.frames) releaseFrameMemory(vm, frame);
  for (const context of vm.scheduler?.contexts.values() ?? []) {
    for (const frame of context.frames) releaseFrameMemory(vm, frame);
  }
}

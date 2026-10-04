/** Task execution captures escaped guest faults after managed cleanup, unlike a process/thread fault. */
export function hasTaskFaultBoundary(vm) {
  const scheduler = vm.scheduler, context = scheduler?.current;
  return !!(scheduler?.enabled && !scheduler.suppressed && context?.task && context.kind !== 'thread' &&
    context.frames === vm.frames);
}

/** The EH trampoline calls this only after every frame and finally continuation has retired. */
export function captureTaskFault(vm, fault) {
  if (!hasTaskFaultBoundary(vm)) return false;
  fault.phase = 'handled';
  vm.fault = fault;
  vm.state = 'faulted';
  return true;
}

/** A delivered await fault can finish a context without executing another guest instruction. */
export function resumeScheduledFault(scheduler) {
  const vm = scheduler.vm;
  // Each zero-instruction handoff retires one context. Recheck the selected context before its next opcode.
  while (scheduler.enabled && !scheduler.suppressed) {
    if (vm.state === 'faulted' && !vm.frames.length && hasTaskFaultBoundary(vm)) scheduler.afterInstruction();
    if (vm.state !== 'running') return;
    const context = scheduler.current;
    if (!context?.resumeFault) return;
    const error = context.resumeFault;
    context.resumeFault = null;
    if (vm.inspector) vm.raise(error);
    else vm.handleFault(error);
  }
}

// CLR managed exception process status; hosts may separately report POSIX signals.
export const unhandledExceptionExitCode = 0xe0434352 | 0;
export const fatalFaults = new Set([
  'InstructionLimitException', 'OutputLimitException', 'ExecutionLimitException',
  'StackOverflowException', 'ExecutionEngineException'
]);

/** Guest-created exception objects are catchable; resource exhaustion faults are not. */
export function isFatalFault(fault) {
  return fault.fatal === true || !fault.reference && fatalFaults.has(fault.name);
}

/** Preserve the first-pass throwing frames for debugger inspection before any cleanup. */
export function markUnhandled(vm, fault) {
  fault.phase = 'unhandled';
  fault.unhandled = true;
  vm.fault = fault;
  vm.exitCode = unhandledExceptionExitCode;
  vm.state = 'faulted';
}

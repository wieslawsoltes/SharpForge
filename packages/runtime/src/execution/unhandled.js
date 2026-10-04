import {
  beginExceptionEvent
} from './exception-events.js';
import {
  ManagedFault
} from '../heap.js';
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
  try {
    if (!isFatalFault(fault) && beginExceptionEvent(vm, fault, 'unhandled')) return;
  } catch (failure) {
    // Failure to enter a callback cannot recursively allocate another notification.
    fault = failure instanceof ManagedFault ? failure : new ManagedFault('ExecutionEngineException', failure.message ?? String(failure));
    fault.fatal = true;
    fault.phase = 'unhandled';
    fault.unhandled = true;
  }
  vm.fault = fault;
  vm.exitCode = fault.runtimeOrigin && fault.fatal && Number.isInteger(fault.processExitCode)
    ? fault.processExitCode | 0 : unhandledExceptionExitCode;
  vm.state = 'faulted';
}

import {ManagedFault} from './managed-fault.js';

/** Missing policy preserves the established behavior of older local and portable snapshots. */
export function firstChanceFailurePolicy(continuation) {
  return continuation.failurePolicy ?? 'before-unwind';
}

/** Preserve notification diagnostics independently of the retired callback frame. */
export function firstChanceCallbackFailure(frame, failure) {
  const event = frame.exceptionEventContinuation;
  if (event?.phase !== 'firstChance') return null;
  const fatal = new ManagedFault('ExecutionEngineException', 'FirstChanceException handler escaped: ' + failure.message);
  fatal.fatal = true;
  fatal.runtimeOrigin = true;
  fatal.processExitCode = 0x80131506 | 0;
  fatal.eventFailureName = failure.name;
  fatal.exceptionEventContinuation = event;
  fatal.callbackFailure = failure;
  return fatal;
}

/** Visit fault diagnostics without recursion; ordinary faults need no traversal allocation. */
export function visitFaultRoots(fault, visit) {
  if (!fault) return;
  if (fault.reference) visit(fault.reference);
  if (!fault.exceptionEventContinuation && !fault.callbackFailure) return;
  const pending = [fault], seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (current !== fault && current.reference) visit(current.reference);
    const event = current.exceptionEventContinuation;
    if (event) {
      for (const value of event.handlers) if (value !== null) visit(value);
      for (const value of event.args) if (value !== null) visit(value);
      pending.push(event.fault);
    }
    if (current.callbackFailure) pending.push(current.callbackFailure);
  }
}

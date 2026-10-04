import {ManagedFault} from './managed-fault.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);
/** Retain the scheduler's admission order before resolving any managed delegate. */
export function prepareManagedContext(scheduler) {
  scheduler.ensure();
  scheduler.prune();
  let live = 0;
  for (const context of scheduler.contexts.values()) if (!terminal.has(context.status)) live++;
  if (live >= scheduler.maxContexts) throw new ManagedFault('ExecutionLimitException', 'Managed context limit exceeded');
}

/** Shared managed call-frame admission for delegate work and verified state-machine continuations. */
export function enqueueManagedContext(scheduler, call, options = {}) {
  return scheduler.enqueueCall(call.method, call.arguments, {...options, extra: call.extra ?? {}});
}

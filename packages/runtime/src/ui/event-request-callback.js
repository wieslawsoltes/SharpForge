import {ManagedFault} from '../heap.js';
import {managedDelegateTarget} from './delegate-target.js';

/** Execute callbacks in the normal cooperative scheduler so async kickoff prefixes can acquire event deferrals. */
export async function invokeRequestedEventCallback(context, entry, handler, args) {
  const signal = entry.controller.signal;
  signal.throwIfAborted();
  if (context.platform.vm.state === 'paused') {
    throw new ManagedFault('InvalidOperationException', 'Continue execution before interacting with the managed application');
  }
  if (typeof handler === 'function' || managedDelegateTarget(context.platform.vm, handler, args).native) {
    const result = context.work.enterThread(() => context.invokeManaged(handler, args));
    if (result && typeof result.then === 'function') {
      throw new ManagedFault('InvalidOperationException', 'Native event callbacks must use the registered managed deferral contract');
    }
    return;
  }
  const scheduler = context.platform.vm.scheduler;
  const id = scheduler.enqueue(handler, args, {kind: 'ui', name: entry.event});
  const completed = scheduler.waitForContext(id, {signal});
  context.platform.options.onUIWork?.();
  await completed;
  signal.throwIfAborted();
  // Async.Start executes eagerly until its first pending await before its kickoff returns.
  // Faults in a deferred async-void body still reject the pending native decision.
  for (const child of scheduler.contexts.values()) {
    if (child.parentId !== id || child.kind !== 'async') continue;
    if (child.status === 'faulted') throw child.fault ?? new ManagedFault('Exception', 'The asynchronous event handler failed');
    scheduler.waitForContext(child.id, {signal}).catch(error => {
      if (!signal.aborted) entry.group.fail(error);
    });
  }
}

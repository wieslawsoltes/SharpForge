import {
  markUnhandled
} from './unhandled.js';
import {
  discardProvisionalFrames
} from './frame-retirement.js';
import {
  bindContextFrames
} from './frame-lifetimes.js';

export {postAsyncFault, finishControlContext} from './scheduler-context-completion.js';

/** Deliver a posted exception in an ordinary guest callback context after the originating instruction. */
export function flushAsyncFault(scheduler) {
  if (!scheduler.unhandledFault || scheduler.suppressed) return false;
  const vm = scheduler.vm,
    fault = scheduler.unhandledFault;
  vm.heap.withRoots([fault.reference], () => {
    scheduler.unhandledFault = null;
    scheduler.cancelAll();
    discardProvisionalFrames(vm);
    vm.frames = [];
    if (!vm.inspector) vm.stack = [];
    vm.pendingFault = vm.fault = null;
    vm.state = 'running';
    scheduler.parked = false;
    scheduler.enabled = true;
    const id = scheduler.nextId++;
    scheduler.currentId = id;
    const context = {
      id,
      name: 'Unhandled asynchronous exception',
      kind: 'exception-event',
      status: 'running',
      frozen: false,
      parentId: null,
      task: null,
      thread: null,
      wait: null,
      ...scheduler.capture()
    };
    scheduler.contexts.set(id, context);
    markUnhandled(vm, fault);
    Object.assign(context, scheduler.capture());
    bindContextFrames(vm, context);
    if (vm.state === 'faulted') {
      context.status = 'faulted';
      context.frames = [];
      context.stack = [];
    }
  });
  return true;
}

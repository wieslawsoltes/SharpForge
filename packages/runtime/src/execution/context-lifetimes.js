import {releaseFrame, releaseAllFrames} from './frame-lifetimes.js';
import {releaseStackFrame, clearStackBudget} from './stack-budget.js';
import {retirePooledFrame} from './frame-pool.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Faulted process stacks stay visible and rooted until explicit stop or restore. */
export function retainsContextFrames(context) {
  return !terminal.has(context.status) || context.preserveFrames === true;
}

export function releaseContextFrames(vm, context) {
  for (const frame of context.frames) {
    releaseFrame(vm, frame);
    releaseStackFrame(vm, frame);
    retirePooledFrame(vm, frame);
  }
  context.frames = [];
  context.stack = [];
  context.preserveFrames = false;
}

export function finishContext(scheduler, context) {
  if (terminal.has(context.status)) return;
  const vm = scheduler.vm;
  vm.sync?.cancelContext(context.id);
  context.status = vm.state === 'faulted' ? 'faulted' : 'completed';
  Object.assign(context, scheduler.capture());
  context.preserveFrames = !!context.fault && (context.fault.fatal === true
    || context.fault.unhandled === true && (!context.task || context.kind === 'thread'));
  const postedFault = context.kind === 'async-void'
    || ['awaiter-continuation', 'async-state-machine'].includes(context.kind) && !context.task;
  if (context.fault && postedFault) {
    scheduler.postAsyncFault(context.fault);
  }
  if (context.task) scheduler.complete(scheduler.taskRecord(context.task), context.returnValue, context.fault);
  if (!context.preserveFrames) releaseContextFrames(vm, context);
  context.delegate = null;
  if (context.eagerParent) {
    scheduler.preferred = context.eagerParent;
    context.eagerParent = null;
  }
}

/** Cancellation releases leases unless the debugger owns a retained fault stack. */
export function cancelContexts(scheduler, {preserveCurrent = false} = {}) {
  const vm = scheduler.vm;
  scheduler.unhandledFault = null;
  vm.sync?.clear();
  scheduler.save();
  if (!scheduler.enabled) {
    if (!preserveCurrent) { releaseAllFrames(vm); clearStackBudget(vm); }
    return;
  }
  for (const context of scheduler.contexts.values()) {
    if (preserveCurrent && context.id === scheduler.currentId) {
      context.status = 'faulted';
      context.preserveFrames = true;
      context.wait = null;
      continue;
    }
    if (!terminal.has(context.status)) context.status = 'canceled';
    releaseContextFrames(vm, context);
    context.wait = null;
  }
  for (const task of scheduler.tasks.values()) {
    if (!terminal.has(task.status)) scheduler.complete(task, null, null, true);
  }
}

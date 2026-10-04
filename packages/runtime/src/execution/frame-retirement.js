import {finishControlContext} from './scheduler-async-faults.js';
import {retirePooledFrame, flushFramePool, clearFramePool} from './frame-pool.js';
import {releaseStackFrame, clearStackBudget} from './stack-budget.js';
import {forgetContextSuspension} from './context-events.js';
import {releaseFrame, clearFrameIndex} from './frame-lifetimes.js';
import {callbackFrames, clearCallbackStorage} from './callback-frames.js';

/** Remove an exited frame; defer clearing until its return/unwind handler finishes. */
export function popPooledFrame(vm) {
  const frame = vm.frames.pop();
  if (frame) {
    releaseFrame(vm, frame);
    releaseStackFrame(vm, frame);
    retirePooledFrame(vm, frame);
  }
  return frame;
}

/** Parked contexts are live. Only explicit terminal disposal retires their frames. */
export function discardContextFrames(vm, context, preserveActive = true) {
  const active = context.frames === vm.frames;
  for (const frame of active && preserveActive ? [] : context.frames) {
    // A current fatal stack remains inspectable until stop or restore.
    releaseFrame(vm, frame);
    releaseStackFrame(vm, frame);
    retirePooledFrame(vm, frame);
  }
  if (active && !preserveActive) vm.frames.length = 0;
  context.frames = [];
  context.stack = [];
  flushFramePool(vm);
}

/** Enqueue failures cannot retain partially admitted frames or their stack-byte reservation. */
export function discardProvisionalFrames(vm) {
  while (vm.frames.length) popPooledFrame(vm);
  if (!vm.inspector) vm.stack.length = 0;
  flushFramePool(vm);
}

export function stopFramePool(vm) {
  clearFrameIndex(vm);
  for (const frame of vm.frames) retirePooledFrame(vm, frame);
  for (const frame of callbackFrames(vm.scheduler)) retirePooledFrame(vm, frame);
  for (const context of vm.scheduler?.contexts.values() ?? []) {
    for (const frame of context.frames) retirePooledFrame(vm, frame);
  }
  clearFramePool(vm);
  clearStackBudget(vm);
  clearCallbackStorage(vm.scheduler);
}

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Complete task delivery before releasing the execution context's storage. */
export function finishContext(scheduler, context) {
  forgetContextSuspension(scheduler, context);
  if (terminal.has(context.status)) return;
  context.status = scheduler.vm.state === 'faulted' ? 'faulted' : 'completed';
  Object.assign(context, scheduler.capture());
  if (context.task) {
    const task = scheduler.taskRecord(context.task);
    scheduler.complete(task, context.returnValue, context.fault);
  }
  finishControlContext(scheduler, context);
  discardContextFrames(scheduler.vm, context, false);
  context.delegate = null;
  if (context.eagerParent) {
    scheduler.preferred = context.eagerParent;
    context.eagerParent = null;
  }
}

/** Dispose parked contexts while retaining the active fatal stack for inspection. */
export function cancelContexts(scheduler) {
  forgetContextSuspension(scheduler);
  if (!scheduler.enabled) return;
  for (const context of scheduler.contexts.values()) {
    if (terminal.has(context.status)) continue;
    scheduler.vm.sync?.cancelContext(context.id);
    context.status = 'canceled';
    discardContextFrames(scheduler.vm, context);
    context.wait = null;
  }
  for (const task of scheduler.tasks.values()) {
    if (!terminal.has(task.status)) scheduler.complete(task, null, null, true);
  }
}

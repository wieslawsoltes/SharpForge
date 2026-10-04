import {retirePooledFrame, flushFramePool, clearFramePool} from './frame-pool.js';

/** Remove an exited frame; defer clearing until its return/unwind handler finishes. */
export function popPooledFrame(vm) {
  const frame = vm.frames.pop();
  if (frame) retirePooledFrame(vm, frame);
  return frame;
}

/** Parked contexts are live. Only explicit terminal disposal retires their frames. */
export function discardContextFrames(vm, context) {
  for (const frame of context.frames === vm.frames ? [] : context.frames) {
    // A current fatal stack remains inspectable until stop or restore.
    retirePooledFrame(vm, frame);
  }
  context.frames = [];
  context.stack = [];
  flushFramePool(vm);
}

export function stopFramePool(vm) {
  for (const frame of vm.frames) retirePooledFrame(vm, frame);
  for (const context of vm.scheduler?.contexts.values() ?? []) {
    for (const frame of context.frames) retirePooledFrame(vm, frame);
  }
  clearFramePool(vm);
}

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Complete task delivery before releasing the execution context's storage. */
export function finishContext(scheduler, context) {
  if (terminal.has(context.status)) return;
  context.status = scheduler.vm.state === 'faulted' ? 'faulted' : 'completed';
  Object.assign(context, scheduler.capture());
  if (context.task) {
    const task = scheduler.taskRecord(context.task);
    scheduler.complete(task, context.returnValue, context.fault);
  }
  discardContextFrames(scheduler.vm, context);
  context.delegate = null;
  if (context.eagerParent) {
    scheduler.preferred = context.eagerParent;
    context.eagerParent = null;
  }
}

/** Dispose parked contexts while retaining the active fatal stack for inspection. */
export function cancelContexts(scheduler) {
  if (!scheduler.enabled) return;
  for (const context of scheduler.contexts.values()) {
    if (terminal.has(context.status)) continue;
    context.status = 'canceled';
    discardContextFrames(scheduler.vm, context);
    context.wait = null;
  }
  for (const task of scheduler.tasks.values()) {
    if (!terminal.has(task.status)) scheduler.complete(task, null, null, true);
  }
}

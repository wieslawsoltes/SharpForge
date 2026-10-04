import {ManagedFault} from '../heap.js';
import {bindCallbackFrames, releaseCallbackFrames} from './frame-lifetimes.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Retain live interrupted storage, including later byref writes, until synchronous evaluation returns. */
export function retainCallbackFrames(scheduler, execution) {
  const scopes = scheduler.callbackScopes ??= [];
  if (scopes.length >= 128) {
    const fault = new ManagedFault('ExecutionLimitException', 'Nested synchronous callback limit exceeded');
    fault.fatal = true;
    throw fault;
  }
  const scope = {canceled: false, frames: execution.frames, stack: execution.stack,
    returnValue: execution.returnValue, pendingFault: execution.pendingFault, fault: execution.fault};
  bindCallbackFrames(scheduler.vm, scope);
  scopes.push(scope);
  return {scope, release() {
    if (scopes.at(-1) !== scope) throw new Error('Synchronous callback scopes must unwind in reverse order');
    scopes.pop();
    releaseCallbackFrames(scheduler.vm, scope);
  }};
}

/** Stop cancels every JavaScript continuation before releasing any retained frame storage. */
export function cancelCallbackScopes(scheduler) {
  for (const scope of scheduler?.callbackScopes ?? []) scope.canceled = true;
}

/** Execution snapshots cannot serialize the JavaScript continuation returning into an interrupted builtin. */
export function requireSnapshotBoundary(vm) {
  if (vm.scheduler?.callbackScopes?.length) {
    throw new TypeError('Execution snapshot and restore are unavailable during synchronous managed callbacks');
  }
}

/** Drop retained roots only after stop has retired their pooled storage. */
export function clearCallbackStorage(scheduler) {
  for (const scope of scheduler?.callbackScopes ?? []) {
    scope.frames.length = 0;
    if (scope.stack) scope.stack.length = 0;
    scope.returnValue = scope.pendingFault = scope.fault = null;
  }
}

/** Retained outer frames are still live for byref storage, stack budgets and method observations. */
export function* callbackFrames(scheduler) {
  for (const scope of scheduler?.callbackScopes ?? []) yield* scope.frames;
}

/** Enumerate all live storage without replacing the interrupted scheduler context with callback frames. */
export function executionFrames(scheduler) {
  if (!scheduler.suppressed && !scheduler.callbackScopes?.length) {
    if (!scheduler.enabled) return scheduler.vm.frames;
    scheduler.save();
    return [...scheduler.contexts.values()].flatMap(context => terminal.has(context.status) ? [] : context.frames);
  }
  const frames = new Set(scheduler.vm.frames);
  for (const frame of callbackFrames(scheduler)) frames.add(frame);
  if (scheduler.enabled) for (const context of scheduler.contexts.values()) {
    if (!terminal.has(context.status)) for (const frame of context.frames) frames.add(frame);
  }
  return [...frames];
}

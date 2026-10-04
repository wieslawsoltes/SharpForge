import {RuntimeEventLog, RuntimeEventName} from './runtime-events.js';

// Source observations share the VM lifetime, never its rewindable guest graph.
const observers = new WeakMap();
const terminal = new Set(['completed', 'faulted', 'canceled']);

export function initializeSourceRuntimeEvents(vm, option) {
  if (option === undefined || option === false) return;
  if (option !== true && (!option || typeof option !== 'object' || Array.isArray(option))) {
    throw new TypeError('runtimeEvents must be a boolean or event-log options');
  }
  observers.set(vm, {log: new RuntimeEventLog(option === true ? {} : option), loaded: new WeakSet(), active: new Map()});
}

/** Optional host log. Reading it neither enables instrumentation nor allocates. */
export function sourceRuntimeEvents(vm) {
  return observers.get(vm)?.log ?? null;
}

/** Successful admission only. The active index retains scalar IDs, never pooled frame objects. */
export function enterSourceMethod(vm, frame, reason = 'call') {
  const observer = observers.get(vm);
  if (!observer || observer.active.has(frame.id)) return;
  const method = vm.image.methods[frame.methodId];
  if (!observer.loaded.has(method)) {
    const name = method.qualifiedName ?? method.owner + '::' + method.name;
    observer.log.emit(RuntimeEventName.MethodLoad, {method: frame.methodId, name: name.slice(0, 4096)}, vm.instructions);
    observer.loaded.add(method);
  }
  const active = {method: frame.methodId, frame: frame.id};
  observer.active.set(frame.id, active);
  observer.log.emit(RuntimeEventName.MethodEnter, {...active, reason}, vm.instructions);
}

/** The actual exit boundary follows all finally bodies and precedes pooled storage release. */
export function leaveSourceMethod(vm, frame, reason = 'return') {
  const observer = observers.get(vm), active = observer?.active.get(frame.id);
  if (!active) return;
  observer.active.delete(frame.id);
  observer.log.emit(RuntimeEventName.MethodLeave, {...active, reason}, vm.instructions);
}

function* liveFrames(vm) {
  yield* vm.frames;
  const current = vm.scheduler.currentId;
  for (const [id, context] of vm.scheduler.contexts) {
    if (id === current && !vm.scheduler.parked || terminal.has(context.status)) continue;
    yield* context.frames;
  }
}

function closeMethods(vm, observer, reason, live = null) {
  let closing = null;
  for (const active of observer.active.values()) {
    if (live?.has(active.frame)) continue;
    (closing ??= []).push(active.frame);
  }
  // Reverse admission order closes each discarded stack's callees before callers.
  for (let index = (closing?.length ?? 0) - 1; index >= 0; index--) {
    leaveSourceMethod(vm, {id: closing[index]}, reason);
  }
}

/** Host boundary only: reconcile discarded stacks, then deliver outside managed dispatch. */
export function flushSourceRuntimeEvents(vm) {
  const observer = observers.get(vm);
  if (!observer) return;
  if (observer.active.size) {
    const live = new Set();
    for (const frame of liveFrames(vm)) live.add(frame.id);
    closeMethods(vm, observer, 'canceled', live);
  }
  observer.log.flush();
}

/** Invoke only after successful restore: log history remains, observed spans restart explicitly. */
export function restoreSourceMethodEvents(vm) {
  const observer = observers.get(vm);
  if (!observer) return;
  closeMethods(vm, observer, 'restore');
  for (const frame of liveFrames(vm)) enterSourceMethod(vm, frame, 'restore');
}

/** After shutdown cleanup, including parked contexts; callback failures cannot interrupt disposal. */
export function stopSourceRuntimeEvents(vm) {
  const observer = observers.get(vm);
  if (!observer) return;
  closeMethods(vm, observer, 'stop');
  observer.log.flush();
}

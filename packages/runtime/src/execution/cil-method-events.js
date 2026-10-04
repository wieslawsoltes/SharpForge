import {RuntimeEventLog, RuntimeEventName} from './runtime-events.js';

// Host observations belong to the VM lifetime, not its rewindable execution graph.
const observers = new WeakMap();
const terminalContexts = new Set(['completed', 'faulted', 'canceled']);

export function initializeCilMethodEvents(vm, option) {
  if (option === undefined || option === false) return;
  if (option !== true && (!option || typeof option !== 'object' || Array.isArray(option))) {
    throw new TypeError('runtimeEvents must be a boolean or event-log options');
  }
  observers.set(vm, {log: new RuntimeEventLog(option === true ? {} : option), loaded: new WeakSet(), active: new Map()});
}

/** Optional host-owned log; reading it never allocates a log or enables instrumentation. */
export function cilRuntimeEvents(vm) {
  return observers.get(vm)?.log ?? null;
}

export function enterCilMethod(vm, frame, reason = 'call') {
  if (reason === 'call') vm.profiler?.enter(frame);
  const observer = observers.get(vm);
  if (!observer) return;
  const method = frame.method;
  if (!observer.loaded.has(method)) {
    observer.log.emit(RuntimeEventName.MethodLoad,
      {method: method.token, name: (method.owner + '::' + method.name).slice(0, 4096)}, vm.instructions);
    observer.loaded.add(method);
  }
  observer.active.set(frame.id, {method: method.token, frame: frame.id});
  observer.log.emit(RuntimeEventName.MethodEnter, {method: method.token, frame: frame.id, reason}, vm.instructions);
}

export function leaveCilMethod(vm, frame, reason = 'return') {
  const observer = observers.get(vm);
  if (!observer) return;
  const active = observer.active.get(frame.id);
  if (!active) return;
  observer.active.delete(frame.id);
  observer.log.emit(RuntimeEventName.MethodLeave, {...active, reason}, vm.instructions);
}

function* liveFrames(vm) {
  const current = vm.scheduler?.currentId ?? 1;
  yield* vm.frames;
  for (const [id, context] of vm.scheduler?.contexts ?? []) {
    if (id === current && !vm.scheduler.parked || terminalContexts.has(context.status)) continue;
    yield* context.frames;
  }
}

/** Cancellation may discard a parked stack without executing ret or exceptional unwind. */
export function flushCilMethodEvents(vm) {
  const observer = observers.get(vm);
  if (!observer) return;
  const live = new Set();
  for (const frame of liveFrames(vm)) live.add(frame.id);
  let discarded = null;
  for (const active of observer.active.values()) {
    if (live.has(active.frame)) continue;
    if (!discarded) discarded = [];
    discarded.push(active.frame);
  }
  // An entire parked stack can disappear together. Close callees before callers,
  // matching the order of ordinary returns, exception unwind and explicit stop.
  if (discarded) for (let index = discarded.length - 1; index >= 0; index--) {
    leaveCilMethod(vm, {id: discarded[index]}, 'canceled');
  }
  observer.log.flush();
}

/** A restore starts new observed spans; log history and subscriber cursors never rewind. */
export function restoreCilMethodEvents(vm) {
  const observer = observers.get(vm);
  if (!observer) return;
  for (const active of [...observer.active.values()].reverse()) leaveCilMethod(vm, {id: active.frame}, 'restore');
  for (const frame of liveFrames(vm)) enterCilMethod(vm, frame, 'restore');
}

/** Called after VM shutdown has completed, so callback failures cannot prevent cleanup. */
export function stopCilMethodEvents(vm) {
  const observer = observers.get(vm);
  if (!observer) return;
  for (const active of [...observer.active.values()].reverse()) leaveCilMethod(vm, {id: active.frame}, 'stop');
  observer.log.flush();
}

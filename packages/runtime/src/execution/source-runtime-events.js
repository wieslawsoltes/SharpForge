import {RuntimeEventLog} from './runtime-events.js';

// Source observations share the VM lifetime, never its rewindable guest graph.
const logs = new WeakMap();

export function initializeSourceRuntimeEvents(vm, option) {
  if (option === undefined || option === false) return;
  if (option !== true && (!option || typeof option !== 'object' || Array.isArray(option))) {
    throw new TypeError('runtimeEvents must be a boolean or event-log options');
  }
  logs.set(vm, new RuntimeEventLog(option === true ? {} : option));
}

/** Optional host log. Reading it neither enables instrumentation nor allocates. */
export function sourceRuntimeEvents(vm) {
  return logs.get(vm) ?? null;
}

/** Host boundary only: subscriber failures must not enter managed exception dispatch. */
export function flushSourceRuntimeEvents(vm) {
  logs.get(vm)?.flush();
}

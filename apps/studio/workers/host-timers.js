/** Keep browser timer calls on their owning Window or WorkerGlobalScope, regardless of the caller's receiver. */
export function setHostTimer(callback, milliseconds) {
  return globalThis.setTimeout(callback, milliseconds);
}

/** Cancel through the same global timer owner used by setHostTimer. */
export function clearHostTimer(handle) {
  globalThis.clearTimeout(handle);
}

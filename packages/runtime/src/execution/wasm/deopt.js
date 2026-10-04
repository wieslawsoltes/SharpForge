// Debugger policy is independent of code caches and rewindable guest state.
// Weak keys cannot retain returned frames; fresh ids distinguish pooled reuse.
const suppressed = new WeakMap();

function liveFrames(vm) {
  // Keep the inspected current stack even when its scheduler context is terminal.
  return new Set([...vm.frames, ...vm.allFrames()]);
}

export function wasmFrameSuppressed(vm, frame) {
  return suppressed.get(vm)?.get(frame) === frame.id;
}

/** Interpret all currently live CIL invocations; return the number newly marked.
 * A reentrant host request affects the next instruction, never replays its helper.
 */
export function deoptWasmFrames(vm) {
  if (!vm?.inspector || typeof vm.allFrames !== 'function') {
    throw Object.assign(new TypeError('Wasm deoptimization requires a direct-CIL VM'), {code: 'WASM_ENGINE'});
  }
  let marks = suppressed.get(vm);
  if (!marks) suppressed.set(vm, marks = new WeakMap());
  let count = 0;
  for (const frame of liveFrames(vm)) {
    if (marks.get(frame) === frame.id) continue;
    marks.set(frame, frame.id);
    count++;
  }
  return count;
}

/** Preserve host policy for still-live invocation ids across graph replacement. */
export function captureWasmDeopt(vm) {
  const marks = suppressed.get(vm);
  if (!marks) return null;
  const identities = new Set();
  for (const frame of liveFrames(vm)) {
    if (marks.get(frame) === frame.id) identities.add(frame.id);
  }
  return identities;
}

export function restoreWasmDeopt(vm, identities) {
  if (!identities?.size) return;
  const marks = suppressed.get(vm);
  for (const frame of liveFrames(vm)) {
    if (identities.has(frame.id)) marks.set(frame, frame.id);
  }
}

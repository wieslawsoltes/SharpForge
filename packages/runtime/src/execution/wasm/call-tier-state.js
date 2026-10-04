import {executionCodeState} from '../code-version.js';

// Only this leaf is imported by the call/step envelopes. The compiling driver
// depends on those envelopes through the manual bridge, never the reverse.
const owners = new WeakMap();
const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);

export function installWasmCallTier(vm, owner) { owners.set(vm, owner); }
export function wasmCallTierOwner(vm) { return owners.get(vm); }

function invalidate(state) {
  if (state.invalidated) return;
  state.invalidated = true;
  state.owner.cancellations = increment(state.owner.cancellations);
  for (const record of state.records.values()) record.prepared?.dispose();
  state.records.clear();
  state.queue.length = 0;
  state.queueHead = 0;
  state.compiledBytes = 0;
  state.frames = new WeakMap();
}

function current(vm, state) {
  return !state.invalidated && state.epoch === executionCodeState(vm) &&
    state.report === vm.report && state.heap === vm.heap;
}

function generation(vm, owner) {
  let state = owner.state;
  if (state && current(vm, state)) return state;
  state?.invalidate();
  const epoch = executionCodeState(vm);
  state = {owner, epoch, report: vm.report, heap: vm.heap, invalidated: false,
    records: new Map(), queue: [], queueHead: 0, frames: new WeakMap(), calls: 0, overflowCalls: 0,
    selectedCalls: 0, selectedInstructions: 0, compiledBytes: 0};
  state.invalidate = () => invalidate(state);
  epoch.wasmCalls = state;
  owner.state = state;
  return state;
}

/** Observe a real call, never a restored frame or an instruction/back edge. */
export function observeWasmCall(vm, frame) {
  const owner = owners.get(vm);
  if (!owner?.enabled) return;
  const state = generation(vm, owner);
  state.calls = increment(state.calls);
  let record = state.records.get(frame.method);
  if (!record) {
    if (state.records.size >= owner.options.maxMethods) {
      state.overflowCalls = increment(state.overflowCalls);
      return;
    }
    record = {method: frame.method, token: frame.method.token,
      name: (frame.method.owner + '::' + frame.method.name).slice(0, 4096),
      calls: 0, status: 'cold', reason: null, prepared: null, bytes: 0};
    state.records.set(frame.method, record);
  }
  record.calls = increment(record.calls);
  if (record.status === 'ready') {
    if (!record.prepared.current()) {
      record.prepared.dispose();
      record.prepared = null;
      record.status = 'fallback';
      record.reason = {code: 'WASM_STALE', message: 'Prepared method ownership changed; interpretation continues.'};
      state.compiledBytes -= record.bytes;
      record.bytes = 0;
      return;
    }
    let selected = state.frames.get(frame);
    if (!selected) {
      selected = {id: frame.id, method: frame.method, record};
      state.frames.set(frame, selected);
    } else {
      selected.id = frame.id;
      selected.method = frame.method;
      selected.record = record;
    }
    state.selectedCalls = increment(state.selectedCalls);
  } else if (record.status === 'cold' && record.calls >= owner.options.callThreshold) {
    record.status = 'queued';
    state.queue.push(record);
    owner.schedule();
  }
}

/** A selection belongs to this call's fresh frame id; readiness never changes a running frame. */
export function dispatchWasmCall(vm, frame, instruction, index, handler) {
  const owner = owners.get(vm), state = owner?.state;
  if (!owner?.enabled || !state || !current(vm, state)) {
    state?.invalidate();
    return handler(vm, frame, instruction);
  }
  const selected = state.frames.get(frame);
  if (!selected || selected.id !== frame.id || selected.method !== frame.method || !selected.record.prepared) {
    return handler(vm, frame, instruction);
  }
  state.selectedInstructions = increment(state.selectedInstructions);
  return selected.record.prepared.dispatch(vm, frame, instruction, index, handler);
}

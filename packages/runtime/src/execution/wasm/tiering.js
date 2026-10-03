import {compileWasmMethod} from './compile.js';
import {instantiatedMethod} from '../generics.js';
import {invokeWasmEntry, leaveWasmFrame} from './deopt.js';
import {wasmTierState, wasmTierEnabled, wasmMethodRecord, wasmFrameState} from './tiering-state.js';

function considerCompilation(vm, state, record) {
  if (record.status === 'cold' && (record.calls >= state.options.callThreshold || record.backedges >= state.options.backedgeThreshold)) {
    compileWasmMethod(vm, state, record);
  }
}

function recordBackedge(vm, state, record, current, frame, index) {
  if (vm.top !== frame || frame.method !== current.method || frame.id !== current.id || frame.pc > index) return;
  if (!frame.method.instructions[frame.pc]) return;
  record.backedges++;
  current.nextEntry = frame.pc;
  considerCompilation(vm, state, record);
}

/** Execute exactly one CIL instruction; a live backward target is an OSR entry. */
export function executeTieredInstruction(vm, frame, plan, index) {
  const state = wasmTierState(vm);
  const record = wasmMethodRecord(state, frame.method);
  if (!wasmTierEnabled(vm) || state.disposed || !record) return plan.handlers[index](vm, frame, plan.instructions[index]);
  const current = wasmFrameState(state, frame);
  considerCompilation(vm, state, record);
  if (!current.active && record.status === 'ready' && (index === 0 || current.nextEntry === index)) {
    current.active = true;
    state.statistics[index === 0 ? 'entryTransitions' : 'osrTransitions']++;
  }
  current.nextEntry = null;
  const instruction = record.ir?.instructions[index];
  if (current.active && (!instruction || record.context.active ||
      instruction.depth !== null && frame.stack.length !== instruction.depth)) {
    leaveWasmFrame(state, current, 'frame-shape');
  }
  try {
    if (current.active) {
      invokeWasmEntry(record, vm, frame, plan, index);
      state.statistics[instruction.kind === 'host' ? 'bridgeInstructions' : 'nativeInstructions']++;
    } else plan.handlers[index](vm, frame, plan.instructions[index]);
  } catch (error) {
    leaveWasmFrame(state, current, 'exception');
    throw error;
  }
  recordBackedge(vm, state, record, current, frame, index);
}

/** Prewarm a method without executing IL; opt-in is required and failures produce fallback reports. */
export async function prepareWasmTier(vm, method = vm.top?.method) {
  if (!wasmTierEnabled(vm)) return Object.freeze({status: 'disabled', reason: 'Wasm tiering is not enabled.'});
  if (!method) return Object.freeze({status: 'fallback', reason: 'No method was selected.'});
  method = instantiatedMethod(vm, typeof method === 'number' ? method : method.token,
    method.genericIdentity ?? null, method.methodArguments ?? []);
  const state = wasmTierState(vm);
  const record = wasmMethodRecord(state, method);
  if (!record) return Object.freeze({status: 'fallback', reason: 'Wasm code-cache capacity reached.'});
  const promise = compileWasmMethod(vm, state, record);
  if (promise) await promise;
  return Object.freeze({status: record.status, reason: record.reason, eligibility: record.eligibility});
}

/** Force interpreter re-entry at the current canonical safepoint, without changing PC or values. */
export function deoptWasmTier(vm, reason = 'explicit') {
  const state = wasmTierState(vm);
  for (const frame of vm.frames) {
    const current = state.frames.get(frame);
    if (current) leaveWasmFrame(state, current, reason);
  }
}

/** Release tier code and prevent pending compilations publishing until the next code epoch. */
export function disposeWasmTier(vm) {
  const state = wasmTierState(vm);
  deoptWasmTier(vm, 'disposed');
  state.disposed = true;
  for (const record of state.records) {
    record.entries = null;
    record.context = null;
    record.ir = null;
  }
  state.methods = new WeakMap();
  state.records.clear();
}

/** Read tier counters and diagnostic reasons without exposing modules, functions or execution frames. */
export function wasmTierStatistics(vm) {
  const state = wasmTierState(vm);
  return Object.freeze({enabled: wasmTierEnabled(vm) && !state.disposed, epoch: state.epoch, ...state.statistics,
    methods: Object.freeze([...state.records].map(record => Object.freeze({token: record.method.token,
      status: record.status, calls: record.calls, backedges: record.backedges, reason: record.reason})))});
}

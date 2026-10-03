import {compileWasmMethod} from './compile.js';
import {instantiatedMethod} from '../generics.js';
import {invokeWasmEntry, leaveWasmFrame} from './deopt.js';
import {wasmTierState, wasmTierEnabled, wasmMethodRecord, wasmFrameState} from './tiering-state.js';
import {RuntimeEventName} from '../runtime-events.js';
import {countWasmBackedge, wasmBackedgeStatistics} from './backedge-counters.js';

function considerCompilation(vm, state, record) {
  if (record.status === 'cold' && (record.calls >= state.options.callThreshold || record.hottestBackedge >= state.options.backedgeThreshold)) {
    compileWasmMethod(vm, state, record);
  }
}

function recordBackedge(vm, state, record, current, frame, index) {
  if (vm.top !== frame || frame.method !== current.method || frame.id !== current.id || frame.pc > index) return;
  const instruction = frame.method.instructions[index];
  if (instruction.name !== 'switch' && !instruction.operandKind.startsWith('br')) return;
  if (!frame.method.instructions[frame.pc]) return;
  countWasmBackedge(state, record, index, frame.pc);
  current.nextEntry = frame.pc;
  considerCompilation(vm, state, record);
}

/** Execute exactly one CIL instruction; a live backward target is an OSR entry. */
export function executeTieredInstruction(vm, frame, plan, index) {
  const state = wasmTierState(vm);
  if (!wasmTierEnabled(vm) || state.disposed) return plan.handlers[index](vm, frame, plan.instructions[index]);
  const record = wasmMethodRecord(state, frame.method);
  if (!record) return plan.handlers[index](vm, frame, plan.instructions[index]);
  const current = wasmFrameState(state, frame);
  considerCompilation(vm, state, record);
  const entry = !current.started && index === 0;
  const transition = !current.active && record.status === 'ready' && (entry || current.nextEntry === index);
  current.started = true;
  current.nextEntry = null;
  const instruction = record.ir?.instructions[index];
  if ((current.active || transition) && (!instruction || record.context.active ||
      instruction.depth !== null && frame.stack.length !== instruction.depth)) {
    leaveWasmFrame(state, current, 'frame-shape');
  } else if (transition) {
    current.active = true;
    state.statistics[entry ? 'entryTransitions' : 'osrTransitions']++;
    if (vm.profiler) vm.profiler.event(RuntimeEventName.TierUp, {
      method: vm.profiler.method(frame), methodToken: frame.method.token, frame: frame.id,
      kind: entry ? 'entry' : 'osr', ilOffset: plan.instructions[index].offset, epoch: state.epoch
    });
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
  if (!vm.inspector) return Object.freeze({status: 'fallback', reason: 'Wasm tiering requires the direct CIL backend.'});
  if (!wasmTierEnabled(vm)) return Object.freeze({status: 'disabled', reason: 'Wasm tiering is not enabled.'});
  if (!method) return Object.freeze({status: 'fallback', reason: 'No method was selected.'});
  // Restored frames retain immutable method identities while the generic cache
  // is rebuilt. Prewarm the actual suspended frame, not an equivalent new clone.
  const liveMethod = typeof method === 'object' && vm.allFrames().some(frame => frame.method === method);
  if (!liveMethod) {
    method = instantiatedMethod(vm, typeof method === 'number' ? method : method.token,
      method.genericIdentity ?? null, method.methodArguments ?? []);
  }
  const state = wasmTierState(vm);
  if (state.disposed) return Object.freeze({status: 'fallback', reason: 'Wasm tier has been disposed for this code epoch.'});
  const record = wasmMethodRecord(state, method);
  if (!record) return Object.freeze({status: 'fallback', reason: 'Wasm code-cache capacity reached.'});
  let promise = compileWasmMethod(vm, state, record);
  if (!promise && record.status === 'cold' && !state.disposed) {
    await Promise.all([...state.records].filter(item => item.status === 'compiling').map(item => item.promise));
    promise = compileWasmMethod(vm, state, record);
  }
  if (promise) await promise;
  return Object.freeze({status: record.status, reason: record.reason, eligibility: record.eligibility});
}

/** Force interpreter re-entry at the current canonical safepoint, without changing PC or values. */
export function deoptWasmTier(vm, reason = 'explicit') {
  const state = wasmTierState(vm);
  for (const frame of vm.allFrames()) {
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
      status: record.status, calls: record.calls, backedges: record.backedges,
      backedgeSites: wasmBackedgeStatistics(record), backedgeOverflow: record.backedgeOverflow, reason: record.reason})))});
}

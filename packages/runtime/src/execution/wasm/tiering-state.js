import {executionCodeState} from '../code-version.js';

const states = new WeakMap();
const defaults = Object.freeze({callThreshold: 32, backedgeThreshold: 256,
  maxMethodInstructions: 4096, maxMethods: 64, maxConcurrentCompilations: 2, maxBackedgesPerMethod: 1024});

function configuration(vm) {
  const configured = typeof vm.options.wasmTiering === 'object' ? vm.options.wasmTiering : {};
  const options = {...defaults, ...configured};
  for (const key of Object.keys(defaults)) {
    const maximum = key === 'maxMethodInstructions' || key === 'maxBackedgesPerMethod' ? 65536 : key === 'maxMethods' ? 1024 :
      key === 'maxConcurrentCompilations' ? 8 : 0x7fffffff;
    if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > maximum) {
      throw new RangeError(`Invalid Wasm tiering ${key}`);
    }
  }
  return Object.freeze(options);
}

/** Tier state is derived, VM-owned execution data, excluded from snapshots and frame pools. */
export function wasmTierState(vm) {
  const epoch = executionCodeState(vm).epoch;
  let state = states.get(vm);
  if (!state || state.epoch !== epoch) {
    if (state) state.disposed = true;
    state = {epoch, options: configuration(vm), disposed: false, methods: new WeakMap(), records: new Set(),
      frames: new WeakMap(), statistics: {compilations: 0, pending: 0, failed: 0, compiledBytes: 0,
        nativeInstructions: 0, bridgeInstructions: 0, entryTransitions: 0, osrTransitions: 0, deoptimizations: 0}};
    states.set(vm, state);
  }
  return state;
}

/** Return a stable private method record, bounded by the configured code-cache capacity. */
export function wasmMethodRecord(state, method) {
  let record = state.methods.get(method);
  if (record) return record;
  if (state.records.size >= state.options.maxMethods) return null;
  record = {method, calls: 0, backedges: 0, hottestBackedge: 0,
    backedgeSites: new Map(), backedgeSiteCount: 0, backedgeOverflow: 0, status: 'cold', reason: null, eligibility: null,
    promise: null, entries: null, context: null, ir: null};
  state.methods.set(method, record);
  state.records.add(record);
  return record;
}

export function wasmFrameState(state, frame) {
  let current = state.frames.get(frame);
  if (!current || current.id !== frame.id || current.method !== frame.method) {
    current = {id: frame.id, method: frame.method, active: false, started: false, nextEntry: null, lastDeopt: null};
    state.frames.set(frame, current);
    const record = wasmMethodRecord(state, frame.method);
    if (record) record.calls++;
  }
  return current;
}

/** In-flight instantiation can complete, but cannot publish into a stopped or edited VM. */
export function wasmStateCurrent(vm, state) {
  return !state.disposed && executionCodeState(vm).epoch === state.epoch;
}

export function wasmTierEnabled(vm) {
  return !!vm.inspector && !!vm.options.wasmTiering && vm.options.wasmTiering.enabled !== false;
}

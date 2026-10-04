import {executionCodeState} from '../code-version.js';
import {prepareWasmMethod, preparedWasmDispatch, disposeWasmMethod} from './manual-runtime.js';
import {installWasmCallTier, wasmCallTierOwner} from './call-tier-state.js';
import {wasmBackedgeStatistics} from './backedge-counters.js';

const bounds = Object.freeze({
  callThreshold: [32, 1, 1000000000], maxMethods: [64, 1, 1024], maxConcurrentCompilations: [1, 1, 4],
  backedgeThreshold: [256, 1, 1000000000], maxBackedgesPerMethod: [64, 1, 1024],
  maxMethodInstructions: [4096, 1, 65536], maxAnalysisSlots: [262144, 1, 16777216],
  maxBytes: [262144, 1, 16777216], maxCompiledBytes: [4194304, 1, 67108864]
});

function configuration(option) {
  if (option === true) option = {};
  if (!option || typeof option !== 'object' || Array.isArray(option)) throw new TypeError('wasmTiering must be a boolean or options');
  for (const key of Object.keys(option)) {
    if (key !== 'osr' && !Object.hasOwn(bounds, key)) throw new TypeError('Unknown Wasm tiering option: ' + key);
  }
  if (option.osr !== undefined && typeof option.osr !== 'boolean') throw new TypeError('Wasm tiering osr must be a boolean');
  const options = {osr: option.osr ?? false};
  for (const [key, [fallback, min, max]] of Object.entries(bounds)) {
    const value = option[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError('Invalid Wasm tiering ' + key);
    options[key] = value;
  }
  return Object.freeze(options);
}

function valid(vm, owner, state) {
  return owner.enabled && owner.state === state && !state.invalidated &&
    state.epoch === executionCodeState(vm) && state.report === vm.report && state.heap === vm.heap;
}

function fallback(record, error) {
  record.status = 'fallback';
  const reason = error.reasons?.[0] ?? error;
  record.reason = {code: typeof reason.code === 'string' ? reason.code.slice(0, 128) : 'WASM_PREPARATION',
    message: String(reason.message ?? reason).slice(0, 1024)};
}

async function compile(vm, owner, state, record) {
  owner.active++;
  owner.attempts = Math.min(Number.MAX_SAFE_INTEGER, owner.attempts + 1);
  record.status = 'compiling';
  const options = owner.options;
  try {
    const handle = await prepareWasmMethod(vm, record.method, {
      maxMethodInstructions: options.maxMethodInstructions, maxAnalysisSlots: options.maxAnalysisSlots,
      maxBytes: Math.min(options.maxBytes, options.maxCompiledBytes)
    });
    if (!valid(vm, owner, state)) {
      disposeWasmMethod(handle);
      state.invalidate();
      return;
    }
    if (state.compiledBytes + handle.byteLength > options.maxCompiledBytes) {
      disposeWasmMethod(handle);
      fallback(record, {code: 'WASM_CODE_BUDGET', message: 'The retained Wasm byte budget is full.'});
      return;
    }
    record.prepared = preparedWasmDispatch(vm, handle);
    record.bytes = handle.byteLength;
    state.compiledBytes += handle.byteLength;
    record.status = 'ready';
  } catch (error) {
    if (valid(vm, owner, state)) fallback(record, error);
    else state.invalidate();
  } finally {
    owner.active--;
    owner.schedule();
  }
}

function pump(vm, owner) {
  owner.scheduled = false;
  const state = owner.state;
  if (!state || !valid(vm, owner, state)) {
    state?.invalidate();
    return;
  }
  while (owner.active < owner.options.maxConcurrentCompilations && state.queueHead < state.queue.length) {
    const record = state.queue[state.queueHead++];
    // Launches are bounded across generations too: canceled native compilations
    // continue occupying a slot until their platform promise settles.
    void compile(vm, owner, state, record);
  }
}

/** Constructor seam. No compilation or state exists when wasmTiering is absent/false. */
export function initializeWasmTiering(vm, option) {
  if (option === undefined || option === false) return;
  const options = configuration(option);
  const owner = {enabled: true, options, state: null, active: 0, attempts: 0, cancellations: 0, scheduled: false};
  owner.schedule = () => {
    const state = owner.state;
    if (owner.scheduled || !owner.enabled || !state || state.queueHead >= state.queue.length) return;
    owner.scheduled = true;
    // Eligibility and encoding run after the current host turn, within explicit
    // analysis/byte limits. This does not create a worker or block for readiness.
    Promise.resolve().then(() => pump(vm, owner));
  };
  installWasmCallTier(vm, owner);
}

/** Cancel queued work and drop compiled selections. Native platform compilation cannot be interrupted. */
export function disposeWasmTiering(vm) {
  const owner = wasmCallTierOwner(vm);
  if (!owner?.enabled) return false;
  owner.enabled = false;
  owner.state?.invalidate();
  return true;
}

/** Data-only counters; null when disabled. Lifetime totals persist; generation counters reset on invalidation. */
export function wasmTieringStatistics(vm) {
  const owner = wasmCallTierOwner(vm);
  if (!owner) return null;
  const state = owner.state;
  if (state && !valid(vm, owner, state)) state.invalidate();
  return Object.freeze({enabled: owner.enabled, epoch: state?.epoch.epoch ?? null,
    invalidated: state?.invalidated ?? false, activeCompilations: owner.active,
    compilationAttempts: owner.attempts, cancellations: owner.cancellations,
    calls: state?.calls ?? 0, overflowCalls: state?.overflowCalls ?? 0,
    selectedCalls: state?.selectedCalls ?? 0, selectedInstructions: state?.selectedInstructions ?? 0,
    osrTransitions: state?.osrTransitions ?? 0, osrRejectedEntries: state?.osrRejectedEntries ?? 0,
    compiledBytes: state?.compiledBytes ?? 0,
    methods: Object.freeze([...(state?.records.values() ?? [])].map(record => Object.freeze({
      token: record.token, name: record.name, calls: record.calls, status: record.status,
      bytes: record.bytes, reason: record.reason ? Object.freeze({...record.reason}) : null,
      ...wasmBackedgeStatistics(record)
    })))
  });
}

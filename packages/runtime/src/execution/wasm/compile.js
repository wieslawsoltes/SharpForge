import {wasmEligibility} from './eligibility.js';
import {encodeWasmIR} from './encoder.js';
import {createWasmImports} from './imports.js';
import {wasmStateCurrent} from './tiering-state.js';

function fallback(record, code, message) {
  record.status = 'fallback';
  record.reason = Object.freeze({code, message});
  return record;
}

/** Queue bounded binary encoding and asynchronous, CSP-compatible WebAssembly compilation. */
export function compileWasmMethod(vm, state, record) {
  if (record.promise || record.status !== 'cold' || state.disposed) return record.promise;
  if (state.statistics.pending >= state.options.maxConcurrentCompilations) return null;
  record.status = 'compiling';
  state.statistics.pending++;
  record.promise = Promise.resolve().then(async () => {
    if (!wasmStateCurrent(vm, state)) return fallback(record, 'WASM_CANCELLED', 'The code epoch was disposed before compilation.');
    if (typeof globalThis.WebAssembly?.instantiate !== 'function') {
      return fallback(record, 'WASM_UNAVAILABLE', 'WebAssembly is unavailable.');
    }
    const eligibility = wasmEligibility(vm, record.method, state.options);
    record.eligibility = eligibility;
    if (!eligibility.eligible) return fallback(record, eligibility.reasons[0].code, eligibility.reasons[0].message);
    const bytes = encodeWasmIR(eligibility.ir);
    const context = {vm: null, frame: null, plan: null, active: false};
    const {instance} = await globalThis.WebAssembly.instantiate(bytes, createWasmImports(context));
    if (!wasmStateCurrent(vm, state)) return fallback(record, 'WASM_CANCELLED', 'The code epoch changed during compilation.');
    record.ir = eligibility.ir;
    record.context = context;
    record.entries = eligibility.ir.instructions.map(instruction => instance.exports[`p${instruction.pc}`]);
    record.status = 'ready';
    state.statistics.compilations++;
    state.statistics.compiledBytes += bytes.length;
    return record;
  }).catch(error => {
    state.statistics.failed++;
    return fallback(record, 'WASM_COMPILE', error.message ?? String(error));
  }).finally(() => { state.statistics.pending--; });
  return record.promise;
}

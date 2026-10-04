import {initializeExecutionProfiler} from './profiler.js';
import {initializeWasmTiering} from './wasm/tiering.js';
import {initializeHeapEvents} from './heap-events.js';

/** Attach optional host instrumentation after heap creation and before entry arguments. */
export function initializeCilInstrumentation(vm, options) {
  initializeExecutionProfiler(vm, options.profile);
  initializeWasmTiering(vm, options.wasmTiering);
  initializeHeapEvents(vm);
}

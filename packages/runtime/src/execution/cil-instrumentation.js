import {initializeExecutionProfiler} from './profiler.js';
import {executionProfiler} from './profiler.js';
import {initializeWasmTiering} from './wasm/tiering.js';
import {initializeHeapEvents} from './heap-events.js';

/** Attach optional host instrumentation after heap creation and before entry arguments. */
export function initializeCilInstrumentation(vm, options, profilerReady) {
  initializeExecutionProfiler(vm, options.profile);
  profilerReady?.(executionProfiler(vm));
  initializeWasmTiering(vm, options.wasmTiering);
  initializeHeapEvents(vm);
}

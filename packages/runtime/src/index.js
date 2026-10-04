export * from './heap.js';
export * from './vm.js';
export * from './cil-vm.js';

export {applyDesignPatch} from './design-patch.js';

export {serializeSnapshot, deserializeSnapshot, restoreSerializedSnapshot, portableSnapshotVersion, SnapshotFormatError}
  from './execution/snapshot-serialize.js';

export {ExecutionProfiler} from './execution/profiler.js';
export {RuntimeEventLog, RuntimeEventName} from './execution/runtime-events.js';
export {exportSpeedscope, exportRuntimeTrace} from './execution/profile-export.js';
export {invalidateExecutionCode, executionCodeStatistics} from './execution/code-version.js';
export {prepareWasmTier, deoptWasmTier, disposeWasmTier, wasmTierStatistics} from './execution/wasm/tiering.js';
export {wasmSafepoint} from './execution/wasm/deopt.js';
export {prepareExecution} from './execution/prepare.js';

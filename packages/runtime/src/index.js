export * from './heap.js';
export * from './vm.js';
export * from './cil-vm.js';
export {runtimeLaunchLimits, runtimeLaunchCapabilities, RuntimeLaunchError, validateProgramArguments,
  validateLaunchEnvironment, normalizeRuntimeLaunchOptions} from './launch-options.js';

export {applyDesignPatch} from './design-patch.js';
export {executionCodeStatistics, invalidateExecutionCode} from './execution/code-version.js';
export {RuntimeEventLog, RuntimeEventName} from './execution/runtime-events.js';
export {framePoolStatistics} from './execution/frame-pool.js';
export {instructionProfile} from './execution/profiler.js';
export {wasmEligibility, lowerWasmIR} from './execution/wasm/eligibility.js';
export {exportSpeedscope} from './execution/profile-export.js';
export {exportRuntimeTrace} from './execution/runtime-trace-export.js';
export {encodeWasmIR} from './execution/wasm/encoder.js';
export {instantiateWasmIR} from './execution/wasm/compile.js';
export {prepareWasmMethod, runWasmSlice, disposeWasmMethod} from './execution/wasm/manual-runtime.js';
export {wasmTieringStatistics, disposeWasmTiering} from './execution/wasm/tiering.js';
export {deoptWasmFrames} from './execution/wasm/deopt.js';
export {prepareExecution, executionPreparationCapabilities} from './execution/prepare.js';
export {snapshotSchemaVersion, SnapshotVersionError} from './execution/snapshot-version.js';
export {serializeSnapshot, deserializeSnapshot, restoreSerializedSnapshot, SnapshotFormatError,
  portableSnapshotVersion} from './execution/snapshot-serialize.js';

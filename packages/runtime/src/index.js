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
export {ManagedInvocationSession} from './invocation-session.js';

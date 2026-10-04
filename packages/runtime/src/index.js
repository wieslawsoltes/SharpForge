export * from './heap.js';
export * from './vm.js';
export * from './cil-vm.js';
export {runtimeLaunchLimits, runtimeLaunchCapabilities, RuntimeLaunchError, validateProgramArguments,
  validateLaunchEnvironment, normalizeRuntimeLaunchOptions} from './launch-options.js';

export {applyDesignPatch} from './design-patch.js';

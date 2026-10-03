export * from './heap.js';
export * from './vm.js';
export * from './cil-vm.js';

export {applyDesignPatch} from './design-patch.js';
export {executionCodeStatistics, invalidateExecutionCode} from './execution/code-version.js';
export {RuntimeEventLog, RuntimeEventName} from './execution/runtime-events.js';

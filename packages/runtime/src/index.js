export * from './heap.js';
export * from './gc/index.js';
export * from './vm.js';
export * from './cil-vm.js';

export {applyDesignPatch} from './design-patch.js';

export {HandleTable} from './gc/handle-table.js';
export {TypeDescriptors, visitEdges, visitEdgeRange} from './gc/type-descriptor.js';
export {recordSize, valueSize} from './gc/sizing.js';
export {executionCodeStatistics, invalidateExecutionCode} from './execution/code-version.js';
export {RuntimeEventLog, RuntimeEventName} from './execution/runtime-events.js';
export {delegateMethodPointer} from './execution/delegate-targets.js';

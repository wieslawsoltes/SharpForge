export * from './heap.js';
export * from './vm.js';
export * from './cil-vm.js';

export {applyDesignPatch} from './design-patch.js';

export {HandleTable} from './gc/handle-table.js';
export {TypeDescriptors, visitEdges, visitEdgeRange} from './gc/type-descriptor.js';
export {recordSize, valueSize} from './gc/sizing.js';

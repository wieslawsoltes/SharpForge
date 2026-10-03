export * from './heap.js';
export * from './vm.js';
export * from './cil-vm.js';

export {applyDesignPatch} from './design-patch.js';

export {serializeSnapshot, deserializeSnapshot, restoreSerializedSnapshot, portableSnapshotVersion, SnapshotFormatError}
  from './execution/snapshot-serialize.js';

export {invalidateExecutionCode, executionCodeStatistics} from './execution/code-version.js';

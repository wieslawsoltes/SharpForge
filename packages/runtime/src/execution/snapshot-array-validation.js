import {validateArrayContinuation} from './array-continuations.js';
import {snapshotAddress} from './snapshot-address-validation.js';
import {invalidSnapshot as fail} from './snapshot-validation-helpers.js';
import {validateSnapshotStoredValue} from './snapshot-storage-validation.js';

/** Native array work retains serializable indices; every backing owner is resolved from the capture. */
export function validateSnapshotArrayWork(context) {
  const {vm, snapshot, frames, referenceRecord} = context;
  const captured = Object.create(context.metadataVM), heap = Object.create(vm.heap);
  Object.defineProperty(heap, 'get', {value: referenceRecord});
  Object.defineProperties(captured, {heap: {value: heap}, frames: {value: snapshot.frames}, statics: {value: snapshot.statics}});
  for (const frame of frames.values()) {
    if (frame.intrinsicContinuation === undefined) continue;
    let work;
    try { work = validateArrayContinuation(captured, frame); }
    catch (error) { fail('array continuation: ' + error.message); }
    if (work && ['Fill', 'Clear'].includes(work.operation)) {
      validateSnapshotStoredValue(context, referenceRecord(work.destination).methodTable.elementType, work.value);
    }
    if (work?.operation === 'IndexOf' && (work.value?.byref || work.value?.span || work.value?.memoryPointer ||
        work.value?.typedReference || work.value?.runtimeArgumentHandle || work.value?.argIterator)) {
      fail('array continuation scoped search value');
    }
    if (work?.resultAddress) {
      const address = snapshotAddress(context, work.resultAddress), destination = referenceRecord(work.destination);
      if (address.readonly || address.onePast || address.type !== destination.methodTable) fail('array continuation result address');
    }
  }
}

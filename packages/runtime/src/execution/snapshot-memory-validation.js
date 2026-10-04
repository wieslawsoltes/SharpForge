import {isReference} from './managed-fault.js';
import {ownsHeapReference} from './heap-reference.js';
import {ReadonlySnapshotArray} from './snapshot-buffers.js';
import {capturedMemoryContext, validateSnapshotRegions} from './snapshot-region-validation.js';
import {validateSnapshotValue} from './snapshot-value-validation.js';
import {snapshotInteger as integer, invalidSnapshot as fail, terminalContext} from './snapshot-validation-helpers.js';

const metadata = new Set(['method', 'offsets', 'vmOwner', 'methodTable']);

function walk(context, roots, options = {}) {
  const {vm, referenceRecord} = context, pending = [...roots], seen = new Set();
  let items = 0;
  while (pending.length) {
    if (++items > 8000000) fail('memory graph item limit');
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value === vm.snapshotOwner || value === vm.heap.handleOwner || ArrayBuffer.isView(value) ||
        value instanceof ArrayBuffer || value instanceof ReadonlySnapshotArray) continue;
    if (value.registry && value.flags) {
      if (value.registry !== vm.heap.methodTables || !Object.isFrozen(value) || vm.heap.methodTables.tables.get(value.name) !== value) {
        fail('type ownership');
      }
      continue;
    }
    if (isReference(value)) {
      if (options.historical) {
        if (!ownsHeapReference(vm.heap, value) || !integer(value.h) || !integer(value.g) || value.g === 0) fail('historical reference ownership');
      } else referenceRecord(value);
      continue;
    }
    validateSnapshotValue(context, value, options);
    if (value instanceof Map) for (const [key, item] of value) pending.push(key, item);
    else if (value instanceof Set) for (const item of value) pending.push(item);
    else for (const [key, item] of Object.entries(value)) if (!metadata.has(key)) pending.push(item);
  }
}

/** Validate captured locations; the running heap may have collected every saved object. */
export function validateCapturedMemory(vm, snapshot, frames, referenceRecord) {
  const context = capturedMemoryContext(vm, snapshot, frames, referenceRecord);
  validateSnapshotRegions(context);
  const stored = snapshot.heap.records.filter(Boolean).map(record => record.data);
  walk(context, [...stored, snapshot.statics], {heapStorage: true});
  const roots = [snapshot.stack, snapshot.returnValue, snapshot.fault, snapshot.pendingFault, snapshot.pendingWrite,
    snapshot.strings, snapshot.typeObjects, snapshot.platform, snapshot.sync, ...frames.values()];
  const historical = [];
  for (const [, saved] of snapshot.scheduler?.contexts ?? []) {
    if (!terminalContext(saved.status)) roots.push(saved);
    else historical.push(saved);
  }
  for (const [, task] of snapshot.scheduler?.tasks ?? []) {
    if (!terminalContext(task.status)) roots.push(task);
    else historical.push(task);
  }
  roots.push(snapshot.scheduler?.unhandledFault);
  for (const [, handle] of snapshot.heap.handles) roots.push(handle.value);
  walk(context, roots);
  // Completed/canceled scheduler rows are retained diagnostics, not collector roots.
  // Preserve ownership checks while allowing their already-collected generations.
  walk(context, historical, {historical: true});
  return context;
}

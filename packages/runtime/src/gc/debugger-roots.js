import {ManagedFault} from './fault.js';
import {isReference} from './reference.js';
import {RootCategory} from './roots.js';

/** Strong references are scoped to one debugger stop; stale snapshot values are never rebound. */
export class DebuggerRootScope {
  constructor(heap, {maxReferences = 10000} = {}) {
    if (!Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 1000000) {
      throw new RangeError('Invalid debugger root budget');
    }
    this.heap = heap;
    this.maxReferences = maxReferences;
    this.handles = new Map();
    this.disposed = false;
  }

  retain(value) {
    if (this.disposed) throw new ManagedFault('ObjectDisposedException', 'Debugger stop has ended');
    const reference = value?.byref ? value.owner : value;
    if (!isReference(reference)) return value;
    this.heap.get(reference);
    const key = `${reference.h}:${reference.g}`;
    const existing = this.handles.get(key);
    if (existing && this.heap.getHandle(existing)) return value;
    if (this.handles.size >= this.maxReferences) {
      throw new ManagedFault('ExecutionLimitException', 'Debugger reference budget exceeded for this stop');
    }
    this.handles.set(key, this.heap.createHandle(reference, {category: RootCategory.Debugger, owner: 'debugger-stop'}));
    return value;
  }

  clear() {
    for (const handle of this.handles.values()) this.heap.releaseHandle(handle);
    this.handles.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }
}

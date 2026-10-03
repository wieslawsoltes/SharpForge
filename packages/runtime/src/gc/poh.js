import {ManagedFault} from './fault.js';

/** Lifetime-pinned allocations are collectible generation-2 objects and never move. */
export class PinnedObjectHeap {
  constructor(heap) {
    this.heap = heap;
  }

  allocateArray(type, length, options = {}) {
    return this.heap.array(type, length, {...options, pinned: true});
  }

  allocateUninitializedArray(type, length, options = {}) {
    // A browser ArrayBuffer is zero-initialized; callers receive at least the CLR safety guarantee.
    return this.heap.array(type, length, {...options, pinned: !!options.pinned, uninitialized: true});
  }

  isPinned(reference) {
    const record = this.heap.get(reference);
    return record.space === 'pinned';
  }

  assertAddressable(reference) {
    const record = this.heap.get(reference);
    if (record.space !== 'pinned' && !record.pinCount) {
      throw new ManagedFault('InvalidOperationException', 'A live pin lease is required for an address token');
    }
    return record;
  }
}

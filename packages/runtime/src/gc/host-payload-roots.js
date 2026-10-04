import {rootReference} from './reference.js';
import {RootCategory} from './roots.js';

function visitPayloadRoots(visitor, category, scope) {
  if (scope.closed) return;
  for (const reference of scope.references) visitor(reference, category, 'payload-owner');
  if (scope.pending !== null) visitor(rootReference(scope.pending) ?? scope.pending, category, 'payload-read');
  for (const value of scope.values ?? []) visitor(rootReference(value) ?? value, category, 'payload-value');
}

/** A cold host callback may collect. Retention is scoped and does not count as a managed data mutation. */
export class HostPayloadRoots {
  constructor(heap, site = 'bulk-copy') {
    this.heap = heap;
    this.site = site;
    this.references = [];
    this.values = null;
    this.pending = null;
    this.storageView = null;
    this.closed = false;
    this.lease = heap.rootRegistry.register(RootCategory.HostOperation, visitPayloadRoots, this);
  }

  validate(value) {
    const reference = rootReference(value);
    if (!reference) return 0;
    this.heap.get(reference);
    // Deterministic omission injection covers all insertion publication owned by
    // the omitted operation; otherwise a temporary root could mask its defect.
    if (!this.heap.barriers.disabledSites?.has(this.site)) this.heap.collector.rootBarrier(reference);
    return 1;
  }

  retain(value) {
    const pending = this.pending;
    this.pending = value;
    try {
      const count = this.validate(value);
      if (count) this.references.push(rootReference(value));
      return count;
    } finally {
      this.pending = pending;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const lease = this.lease;
    this.lease = null;
    lease.dispose();
    this.references.length = 0;
    this.values = null;
    this.pending = null;
    this.storageView = null;
    this.heap = null;
  }
}

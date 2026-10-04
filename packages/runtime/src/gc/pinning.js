import {liveReference, sameReference, noteLifetimeMutation, lifetimeFault} from './lifetime-state.js';
import {RootCategory} from './roots.js';

/** Counted movement exclusion. Every outstanding lease is also a precise strong root. */
export class PinManager {
  constructor(heap, addresses) {
    this.heap = heap;
    this.addresses = addresses;
    this.owner = Object.freeze({});
    this.leases = new Map();
    this.objects = new Map();
    this.nextId = 1;
  }

  acquire(reference, {owner = null, reason = 'host'} = {}) {
    const record = this.heap.get(reference);
    this.heap.spaces.synchronizePayload(record);
    const id = this.nextId;
    if (!Number.isSafeInteger(id)) throw lifetimeFault('Pin lease identity exhausted');
    let object = this.objects.get(reference.h);
    if (!object || !sameReference(object.reference, reference)) {
      object = {reference, address: this.addresses.activate(reference), count: 0};
      this.objects.set(reference.h, object);
    }
    this.nextId++;
    object.count++;
    record.pinCount = (record.pinCount ?? 0) + 1;
    const release = () => this.release(lease);
    const lease = Object.freeze({id, owner: this.owner, reference, address: object.address, dispose: release, [Symbol.dispose]: release});
    this.leases.set(id, {reference, ownerTag: owner, reason, lease});
    this.heap.collector?.rootBarrier(reference);
    noteLifetimeMutation(this.heap);
    this.heap.events?.pin(reference, record, {action: 'pin', leaseId: id});
    return lease;
  }

  release(lease) {
    if (lease?.owner !== this.owner) return false;
    return this.releaseId(lease.id);
  }

  releaseId(id) {
    const entry = this.leases.get(id);
    if (!entry) return false;
    this.leases.delete(id);
    const object = this.objects.get(entry.reference.h);
    if (object && sameReference(object.reference, entry.reference)) {
      object.count--;
      const record = liveReference(this.heap, entry.reference) ? this.heap.records[entry.reference.h] : null;
      if (record) {
        record.pinCount = Math.max(0, (record.pinCount ?? 0) - 1);
        this.heap.events?.pin(entry.reference, record, {action: 'unpin', leaseId: id});
      }
      if (object.count === 0) {
        this.objects.delete(entry.reference.h);
        if (record?.space !== 'pinned') this.addresses.deactivate(entry.reference);
      }
    }
    noteLifetimeMutation(this.heap);
    return true;
  }

  isPinned(reference) {
    const object = this.objects.get(reference?.h);
    return !!object && sameReference(object.reference, reference) && liveReference(this.heap, reference) && object.count > 0;
  }

  visitRoots(visitor) {
    for (const entry of this.objects.values()) visitor(entry.reference, RootCategory.Pinned, `Pinned object (${entry.count} leases)`);
  }

  releaseOwner(owner) {
    let released = 0;
    for (const [id, entry] of this.leases) if (entry.ownerTag === owner && this.releaseId(id)) released++;
    return released;
  }

  releaseAll() {
    const count = this.leases.size;
    for (const id of this.leases.keys()) this.releaseId(id);
    return count;
  }

  report() {
    return [...this.leases.values()].map(entry => ({id: entry.lease.id, reference: entry.reference,
      owner: entry.ownerTag, reason: entry.reason, address: entry.lease.address}));
  }

  snapshot() {
    return {owner: this.owner, nextId: this.nextId, leases: [...this.leases].map(([id, entry]) => [id, {...entry}])};
  }

  restore(state) {
    if (state.owner !== this.owner) throw new TypeError('Pin snapshot belongs to another heap');
    this.nextId = Math.max(this.nextId, state.nextId);
    this.leases = new Map(state.leases.map(([id, entry]) => [id, {...entry}]));
    this.objects.clear();
    for (const record of this.heap.records) if (record) record.pinCount = 0;
    for (const entry of this.leases.values()) {
      const record = this.heap.get(entry.reference);
      let object = this.objects.get(entry.reference.h);
      if (!object) {
        object = {reference: entry.reference, address: entry.lease.address, count: 0};
        this.objects.set(entry.reference.h, object);
      }
      object.count++;
      record.pinCount++;
    }
  }
}

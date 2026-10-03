import {ManagedFault} from './fault.js';
import {isReference} from './reference.js';

/** Per-slot identities with permanent retirement on overflow and rewind high-water marks. */
export class HandleTable {
  constructor(heap, {maxIdentity = Number.MAX_SAFE_INTEGER} = {}) {
    if (!Number.isSafeInteger(maxIdentity) || maxIdentity < 1) throw new RangeError('Invalid handle generation limit');
    this.heap = heap;
    this.maxIdentity = maxIdentity;
    this.highWater = [];
    this.retired = new Set();
  }

  allocate(record) {
    const heap = this.heap;
    let handle;
    while (heap.free.length) {
      const candidate = heap.free.pop();
      if (this.retired.has(candidate)) continue;
      if ((this.highWater[candidate] ?? 0) >= this.maxIdentity) {
        this.retired.add(candidate);
        continue;
      }
      handle = candidate;
      break;
    }
    handle ??= heap.records.length;
    if (handle >= 0xffffffff) throw new ManagedFault('OutOfMemoryException', 'Managed handle table capacity exhausted');
    const generation = (this.highWater[handle] ?? 0) + 1;
    this.highWater[handle] = generation;
    heap.generations[handle] = generation;
    heap.records[handle] = record;
    heap.generationCounter++;
    return Object.freeze({h: handle, g: generation});
  }

  release(handle) {
    const heap = this.heap;
    if (!heap.records[handle]) return false;
    heap.records[handle] = null;
    if (this.highWater[handle] >= this.maxIdentity) this.retired.add(handle);
    else heap.free.push(handle);
    return true;
  }

  get(reference) {
    if (reference === null || reference === undefined) {
      throw new ManagedFault('NullReferenceException', 'Object reference not set to an instance of an object');
    }
    const record = this.tryGet(reference);
    if (!record) throw new ManagedFault('InvalidReferenceException', 'Stale or invalid managed reference');
    return record;
  }

  tryGet(reference) {
    return isReference(reference) && this.heap.generations[reference.h] === reference.g
      ? this.heap.records[reference.h] ?? null : null;
  }

  snapshot() {
    return {version: 1, highWater: [...this.highWater], retired: [...this.retired], maxIdentity: this.maxIdentity};
  }

  validateSnapshot(state) {
    if (state?.version !== 1 || !Array.isArray(state.highWater) || !Array.isArray(state.retired)) {
      throw new TypeError('Invalid handle table snapshot');
    }
    if (state.maxIdentity !== this.maxIdentity) throw new TypeError('Handle identity configuration differs');
    if (state.highWater.some(value => value !== undefined
      && (!Number.isSafeInteger(value) || value < 0 || value > this.maxIdentity))) {
      throw new TypeError('Invalid handle high-water mark');
    }
    for (const index of state.retired) {
      if (!Number.isInteger(index) || index < 0 || index >= state.highWater.length) {
        throw new TypeError('Invalid retired handle');
      }
    }
  }

  restore(state) {
    this.validateSnapshot(state);
    for (let index = 0; index < state.highWater.length; index++) {
      this.highWater[index] = Math.max(this.highWater[index] ?? 0, state.highWater[index] ?? 0);
    }
    for (const index of state.retired) {
      this.retired.add(index);
    }
    // A restored short table must not allocate a slot that existed later in time with identity 1 again.
    const count = Math.max(this.highWater.length, this.heap.records.length);
    while (this.heap.records.length < count) {
      const index = this.heap.records.length;
      this.heap.records.push(null);
      this.heap.generations[index] ??= 0;
      if (!this.retired.has(index)) this.heap.free.push(index);
    }
  }
}

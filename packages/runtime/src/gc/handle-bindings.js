const storedUndefined = Symbol('stored undefined binding');

/** Internal handle-indexed bindings. Publication cannot grow beyond the owning heap's existing record table. */
export class DenseHandleBindings {
  constructor(heap) {
    if (!Array.isArray(heap?.records)) throw new TypeError('A managed record table is required');
    this.heap = heap;
    this.slots = [];
    this.count = 0;
  }

  get size() {
    return this.count;
  }

  get(handle) {
    if (!Number.isInteger(handle) || handle < 0 || handle >= this.heap.records.length) return undefined;
    const binding = this.slots[handle];
    return binding === storedUndefined ? undefined : binding;
  }

  set(handle, binding) {
    if (!Number.isInteger(handle) || handle < 0 || handle >= this.heap.records.length) {
      throw new RangeError('Binding handle is outside the managed record table');
    }
    if (this.slots[handle] === undefined) this.count++;
    this.slots[handle] = binding === undefined ? storedUndefined : binding;
    return this;
  }

  delete(handle) {
    if (!Number.isInteger(handle) || handle < 0 || handle >= this.heap.records.length || this.slots[handle] === undefined) {
      return false;
    }
    this.slots[handle] = undefined;
    this.count--;
    return true;
  }

  clear() {
    this.slots.length = 0;
    this.count = 0;
  }
}

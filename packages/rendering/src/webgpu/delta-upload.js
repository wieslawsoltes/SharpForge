/** Fixed-capacity instance storage; unchanged instances incur no writeBuffer calls. */
export class DeltaUpload {
  constructor({capacity, stride}) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > 1000000) throw new RangeError('Invalid instance capacity');
    if (!Number.isInteger(stride) || stride <= 0 || stride % 4 || stride > 65536) throw new RangeError('Stride must be 4-byte aligned');
    if (capacity * stride > 256 * 1024 * 1024) throw new RangeError('Instance byte limit exceeded');
    this.capacity = capacity;
    this.stride = stride;
    this.bytes = new Uint8Array(capacity * stride);
    this.dirty = new Uint8Array(capacity);
    this.byteViews = new WeakMap();
    this.count = 0;
    this.dirtyCount = 0;
    this.closed = false;
  }

  set(index, value) {
    if (this.closed) throw new Error('Instance upload is disposed');
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity) throw new RangeError('Instance index is out of range');
    if (!ArrayBuffer.isView(value) || value.byteLength !== this.stride) throw new TypeError('Instance data must exactly match stride');
    let source = value instanceof Uint8Array ? value : this.byteViews.get(value);
    if (!source) {
      source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      this.byteViews.set(value, source);
    }
    const offset = index * this.stride;
    let changed = index >= this.count;
    for (let byte = 0; byte < this.stride; byte++) {
      if (this.bytes[offset + byte] !== source[byte]) changed = true;
    }
    if (changed) {
      this.bytes.set(source, offset);
      if (!this.dirty[index]) this.dirtyCount++;
      this.dirty[index] = 1;
    }
    this.count = Math.max(this.count, index + 1);
    return changed;
  }

  invalidate() {
    this.dirty.fill(1, 0, this.count);
    this.dirtyCount = this.count;
  }

  truncate(count) {
    if (!Number.isInteger(count) || count < 0 || count > this.count) throw new RangeError('Invalid instance count');
    for (let index = count; index < this.count; index++) this.dirtyCount -= this.dirty[index];
    this.dirty.fill(0, count, this.count);
    this.count = count;
  }

  flush(queue, buffer) {
    if (this.closed) throw new Error('Instance upload is disposed');
    let uploadedBytes = 0;
    let ranges = 0;
    for (let index = 0; index < this.count && this.dirtyCount; index++) {
      if (!this.dirty[index]) continue;
      const start = index;
      while (index < this.count && this.dirty[index]) index++;
      const length = (index - start) * this.stride;
      queue.writeBuffer(buffer, start * this.stride, this.bytes.buffer, start * this.stride, length);
      this.dirty.fill(0, start, index);
      this.dirtyCount -= index - start;
      uploadedBytes += length;
      ranges++;
    }
    return {uploadedBytes, ranges};
  }

  dispose() {
    this.closed = true;
    this.count = 0;
    this.dirtyCount = 0;
    this.bytes = null;
    this.dirty = null;
    this.byteViews = new WeakMap();
  }
}

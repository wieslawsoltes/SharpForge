import {ManagedFault} from './fault.js';
import {isReference, rootReference} from './reference.js';

function validateValue(heap, value) {
  const reference = rootReference(value);
  if (reference) heap.get(reference);
  return reference ? 1 : 0;
}

function writableRecord(heap, reference, index) {
  const record = heap.get(reference);
  if (record.kind === 'string' || record.space === 'frozen') {
    throw new ManagedFault('InvalidOperationException', 'Managed storage is immutable');
  }
  if (!Number.isInteger(index) || index < 0 || index >= record.data.length) {
    throw new ManagedFault('IndexOutOfRangeException', 'Managed storage index is outside its bounds');
  }
  return record;
}

function range(length, start, count) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0 || start > length - count) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Managed storage range is outside its bounds');
  }
}

/** Store barriers own publication once; referenceStores counts incoming managed references. */
export class HeapBarriers {
  constructor(heap) {
    this.heap = heap;
    this.stores = 0;
    this.referenceStores = 0;
    this.onStore = null;
    this.disabledSites = null;
  }

  writeField(reference, index, value) {
    return this.store(reference, index, value, 'field');
  }

  store(reference, index, value, site) {
    const record = writableRecord(this.heap, reference, index);
    const referenceCount = validateValue(this.heap, value);
    const previous = this.onStore ? record.data[index] : undefined;
    record.data[index] = value;
    const omitted = this.disabledSites?.has(site) ?? false;
    if (!omitted) this.heap.collector.writeBarrier(reference, rootReference(value) ?? value);
    this.heap.background?.writeBarrier(reference);
    this.stores++;
    this.referenceStores += referenceCount;
    this.heap.noteMutation();
    this.onStore?.({site, owner: reference, index, oldValue: previous, newValue: value, omitted});
    return value;
  }

  writeElement(reference, index, value) {
    if (this.heap.get(reference).kind !== 'array') throw new ManagedFault('ArgumentException', 'Array storage required');
    return this.store(reference, index, value, 'element');
  }

  writeRoot(container, index, value, site = 'root') {
    const referenceCount = validateValue(this.heap, value);
    const previous = this.onStore ? container instanceof Map ? container.get(index) : container[index] : undefined;
    if (container instanceof Map) container.set(index, value);
    else container[index] = value;
    const omitted = this.disabledSites?.has(site) ?? false;
    if (!omitted) this.heap.collector.rootBarrier(rootReference(value) ?? value);
    this.stores++;
    this.referenceStores += referenceCount;
    this.heap.noteMutation();
    this.onStore?.({site, owner: null, index, oldValue: previous, newValue: value, omitted});
    return value;
  }

  writeStatic(container, index, value) {
    return this.writeRoot(container, index, value, 'static');
  }

  bulkCopy(destination, start, source, sourceStart, count) {
    const record = this.heap.get(destination);
    const sourceRecord = isReference(source) ? this.heap.get(source) : null;
    const data = sourceRecord ? sourceRecord.data : source;
    if (record.kind === 'string' || record.space === 'frozen' || typeof data?.length !== 'number') {
      throw new ManagedFault('ArgumentException', 'Mutable indexed storage required');
    }
    range(record.data.length, start, count);
    range(data.length, sourceStart, count);
    let referenceStores = 0;
    // Primitive descriptors prove that validation cannot discover a managed reference.
    if (sourceRecord?.descriptor.scan !== 'none') {
      for (let offset = 0; offset < count; offset++) referenceStores += validateValue(this.heap, data[sourceStart + offset]);
    }
    this.heap.spaces.bulkCopy(destination, start, source, sourceStart, count);
    this.publishRange(destination, start, count, 'bulk-copy', {referenceStores});
    return destination;
  }

  fillArray(destination, start, count, value) {
    const record = this.heap.get(destination);
    if (record.kind !== 'array' || record.space === 'frozen') throw new ManagedFault('ArgumentException', 'Mutable array required');
    range(record.data.length, start, count);
    const referenceStores = validateValue(this.heap, value) * count;
    this.heap.spaces.fillArray(destination, start, count, value);
    this.publishRange(destination, start, count, 'array-fill', {referenceStores});
    return destination;
  }

  /** A spatial operation already performed the writes; publish one range to each observer. */
  publishRange(destination, start, count, site, {barrier = true, referenceStores = 0} = {}) {
    if (count === 0) return;
    const omitted = this.disabledSites?.has(site) ?? false;
    if (barrier && !omitted) this.heap.collector.bulkWriteBarrier(destination, start, count);
    this.heap.background?.writeBarrier(destination);
    this.stores += count;
    this.referenceStores += referenceStores;
    this.heap.noteMutation();
    this.onStore?.({site, owner: destination, index: start, count, omitted});
  }

  snapshot() {
    return {stores: this.stores, referenceStores: this.referenceStores};
  }

  restore(state) {
    this.stores = state.stores;
    this.referenceStores = state.referenceStores;
  }
}

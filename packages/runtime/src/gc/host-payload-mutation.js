import {ManagedFault} from './fault.js';
import {HostPayloadRoots} from './host-payload-roots.js';
import {isReference} from './reference.js';
import {assertActiveStorage, publicPayload, readPublicSlot, readStoredSlot, writePublicSlot, writeRawSlot} from './spatial-payload.js';

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length').get;
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const typedOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get;

function range(length, start, count) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0 || start > length - count) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Managed storage range is outside its bounds');
  }
}

/** One cold operation owns its roots, capture and exception-safe attempted-prefix publication. */
class PayloadMutation {
  constructor(barriers, binding, start, site) {
    if (binding.readOnly) throw new ManagedFault('InvalidOperationException', 'Frozen managed data is read-only');
    this.barriers = barriers;
    this.heap = barriers.heap;
    this.binding = binding;
    this.owner = binding.reference;
    this.start = start;
    this.site = site;
    this.values = [];
    this.referenceCounts = [];
    this.referenceStores = 0;
    this.attempted = 0;
    this.scalar = false;
    this.previous = undefined;
    this.roots = new HostPayloadRoots(this.heap, site);
    this.roots.values = this.values;
  }

  capture(value, raw = false) {
    const pending = this.roots.pending;
    this.roots.pending = value;
    try {
      const references = this.roots.validate(value);
      if (raw) this.binding.codec.validateRaw(value);
      else this.binding.codec?.validate(value);
      this.values.push(value);
      this.referenceCounts.push(references);
    } finally {
      this.roots.pending = pending;
    }
  }

  write(data, offset, raw = false) {
    this.attempted = offset + 1;
    this.referenceStores += this.referenceCounts[offset];
    if (raw) writeRawSlot(this.binding, this.start + offset, this.values[offset], data, this.roots);
    else writePublicSlot(this.binding, data, this.start + offset, this.values[offset], this.roots);
  }

  publish(failed) {
    if (!this.attempted) return;
    assertActiveStorage(this.binding);
    const event = this.barriers.publishRange(this.owner, this.start, this.attempted, this.site, {
      values: this.values, referenceStores: this.referenceStores, notify: false,
      scalar: this.scalar, previous: this.previous, value: this.values[0], partial: failed
    });
    if (!event) return;
    try {
      this.barriers.onStore?.(event);
    } catch (error) {
      if (!failed) throw error;
      this.heap.events.observerError('SF-GC-EVENT-001', error?.message ?? error);
    }
  }

  run(action) {
    let result;
    let failed = false;
    let failure;
    try {
      try {
        this.roots.retain(this.owner);
        result = action(this);
      } catch (error) {
        failed = true;
        failure = error;
        this.roots.retain(error);
      }
      this.publish(failed);
      if (failed) throw failure;
      return result;
    } finally {
      this.roots.close();
    }
  }
}

/** Caller validated the destination kind, owner and bounds without invoking host properties. */
export function storeHostPayload(barriers, binding, index, value, {site, raw = false}) {
  const mutation = new PayloadMutation(barriers, binding, index, site);
  mutation.scalar = true;
  return mutation.run(operation => {
    operation.capture(value, raw);
    const data = publicPayload(binding, operation.roots);
    if (barriers.onStore) {
      if (raw) {
        if (data !== binding.view) readPublicSlot(binding, index, operation.roots);
        operation.previous = binding.codec.readRaw(binding.arena.view, binding.block.offset + index);
      } else operation.previous = data === binding.view ? readStoredSlot(binding, index) : data[index];
      operation.roots.retain(operation.previous);
    }
    operation.write(data, 0, raw);
    return value;
  });
}

function sourceStorage(operation, source) {
  if (isReference(source)) {
    operation.roots.retain(source);
    return operation.heap.spaces.getBinding(operation.heap.get(source), false);
  }
  const binding = operation.heap.spaces.views.get(source);
  if (binding) {
    assertActiveStorage(binding);
    operation.roots.retain(binding.reference);
  }
  return binding;
}

function captureSource(operation, source, sourceStart, count) {
  const binding = sourceStorage(operation, source);
  const data = isReference(source) ? publicPayload(binding, operation.roots) : source;
  if (!binding && !Array.isArray(data) && !(ArrayBuffer.isView(data) && Number.isSafeInteger(data.length))) {
    throw new ManagedFault('ArgumentException', 'An array or managed indexed source is required');
  }
  range(binding?.length ?? data.length, sourceStart, count);
  const raw = binding && binding.codec === operation.binding.codec && !!binding.codec?.readRaw;
  for (let index = 0; index < count; index++) {
    const at = sourceStart + index;
    let value = binding ? data === binding.view ? readStoredSlot(binding, at) : readPublicSlot(binding, at, operation.roots) : data[at];
    if (raw) value = binding.codec.readRaw(binding.arena.view, binding.block.offset + at * binding.codec.size);
    operation.capture(value, raw);
  }
  return raw;
}

function copyTypedSource(operation, source, sourceStart, count) {
  const {binding} = operation;
  const Type = binding.codec?.arrayType;
  if (!Type || !ArrayBuffer.isView(source) || Object.getPrototypeOf(source) !== Type.prototype
    || binding.record.data !== binding.view) return false;
  const length = typedLength.call(source);
  range(length, sourceStart, count);
  // Intrinsic getters ignore host-shadowed properties. The normalized view has
  // no user callbacks, so the existing byte-memmove path remains safe and direct.
  const normalized = new Type(typedBuffer.call(source), typedOffset.call(source), length);
  operation.heap.spaces.bulkCopy(operation.owner, operation.start, normalized, sourceStart, count);
  operation.attempted = count;
  return true;
}

/** Host values are read and validated once, then copied from an inaccessible capture with overlap semantics. */
export function copyHostPayload(barriers, binding, start, source, request) {
  const {sourceStart, count} = request;
  const mutation = new PayloadMutation(barriers, binding, start, 'bulk-copy');
  return mutation.run(operation => {
    range(binding.length, start, count);
    if (copyTypedSource(operation, source, sourceStart, count)) return binding.reference;
    const raw = captureSource(operation, source, sourceStart, count);
    const data = publicPayload(binding, operation.roots);
    for (let index = 0; index < count; index++) operation.write(data, index, raw);
    return binding.reference;
  });
}

export function fillHostPayload(barriers, binding, start, count, value) {
  const mutation = new PayloadMutation(barriers, binding, start, 'array-fill');
  return mutation.run(operation => {
    range(binding.length, start, count);
    operation.roots.retain(value);
    operation.roots.values = null;
    if (count) {
      operation.capture(value);
      operation.values.length = count;
      operation.values.fill(value);
      operation.referenceCounts.length = count;
      operation.referenceCounts.fill(operation.referenceCounts[0]);
    }
    const data = publicPayload(binding, operation.roots);
    for (let index = 0; index < count; index++) operation.write(data, index);
    return binding.reference;
  });
}

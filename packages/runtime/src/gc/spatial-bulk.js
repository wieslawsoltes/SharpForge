import {isReference} from './reference.js';
import {ManagedFault} from './fault.js';
import {publicPayload, readStoredSlot, writePublicSlot, writeRawSlot, synchronizePayload} from './spatial-payload.js';

const nativeLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function range(length, start, count) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0 || start > length - count) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Backing storage range is outside its bounds');
  }
}

function liveBinding(spaces, reference, mutable = false) {
  const record = spaces.heap.get(reference);
  const binding = spaces.getBinding(record);
  if (record.kind === 'string' || mutable && binding.readOnly) {
    throw new ManagedFault('InvalidOperationException', 'The requested backing storage is immutable');
  }
  return binding;
}

function copyBytes(target, targetOffset, source, sourceOffset, count) {
  if (target.buffer === source.buffer) target.copyWithin(targetOffset, sourceOffset, sourceOffset + count);
  else target.set(source.subarray(sourceOffset, sourceOffset + count), targetOffset);
}

function copyIdentical(target, start, source, sourceStart, count) {
  if (target.codec && target.codec === source.codec) {
    const width = target.codec.size;
    copyBytes(target.arena.bytes, target.block.offset + start * width,
      source.arena.bytes, source.block.offset + sourceStart * width, count * width);
    return true;
  }
  if (!target.codec && !source.codec) {
    const destination = target.block.offset / 8 + start;
    const begin = source.block.offset / 8 + sourceStart;
    if (target.arena === source.arena) target.arena.values.copyWithin(destination, begin, begin + count);
    else {
      const from = source.arena.values;
      const to = target.arena.values;
      for (let index = 0; index < count; index++) to[destination + index] = from[begin + index];
    }
    return true;
  }
  return false;
}

function directTypedCopy(target, start, source, sourceStart, count) {
  if (!target.codec?.arrayType || source.constructor !== target.codec.arrayType || !nativeLittleEndian) return false;
  const width = target.codec.size;
  const bytes = new Uint8Array(source.buffer);
  copyBytes(target.arena.bytes, target.block.offset + start * width,
    bytes, source.byteOffset + sourceStart * width, count * width);
  return true;
}

function copyPublicRange(target, data, start, source, binding, sourceStart, count) {
  // An arbitrary host Proxy may alias either backing store. Capture before the
  // first write, preserving memmove semantics and validating every scalar first.
  const values = new Array(count);
  const raw = binding && target.codec === binding.codec && !!target.codec?.readRaw;
  for (let index = 0; index < count; index++) {
    const value = raw ? binding.codec.readRaw(binding.arena.view, binding.block.offset + (sourceStart + index) * binding.codec.size)
      : binding ? readStoredSlot(binding, sourceStart + index) : source[sourceStart + index];
    if (raw) target.codec.validateRaw(value);
    else target.codec?.validate(value);
    values[index] = value;
  }
  for (let index = 0; index < count; index++) {
    if (raw) writeRawSlot(target, start + index, values[index], data);
    else writePublicSlot(target, data, start + index, values[index]);
  }
}

/** Bulk backing copy. The heap barrier owns preflight reference checks and one post-copy range barrier. */
export function copySpatialRange(spaces, destination, start, source, sourceStart, count) {
  const target = liveBinding(spaces, destination, true);
  const data = publicPayload(target);
  const managedSource = isReference(source);
  let sourceBinding = managedSource ? liveBinding(spaces, source) : spaces.views.get(source);
  if (sourceBinding?.block.released) throw new ManagedFault('InvalidReferenceException', 'Source array backing storage was reclaimed');
  const input = managedSource ? publicPayload(sourceBinding) : source;
  const detachedSource = managedSource && input !== sourceBinding.view;
  if (detachedSource && !sourceBinding.codec?.readRaw) sourceBinding = null;
  if (!sourceBinding && !Array.isArray(input) && !(ArrayBuffer.isView(input) && Number.isSafeInteger(input.length))) {
    throw new ManagedFault('ArgumentException', 'An array or managed indexed source is required');
  }
  range(target.length, start, count);
  range(sourceBinding?.length ?? input.length, sourceStart, count);
  if (!count) return destination;
  if (detachedSource && sourceBinding) synchronizePayload(sourceBinding, sourceStart, count);
  if (data === target.view && sourceBinding && copyIdentical(target, start, sourceBinding, sourceStart, count)) return destination;
  if (data === target.view && !sourceBinding && ArrayBuffer.isView(input)
    && directTypedCopy(target, start, input, sourceStart, count)) return destination;
  if (data !== target.view || !sourceBinding) {
    copyPublicRange(target, data, start, input, sourceBinding, sourceStart, count);
    return destination;
  }
  const read = index => readStoredSlot(sourceBinding, index);
  if (target.codec) {
    const codec = target.codec;
    for (let index = 0; index < count; index++) codec.validate(read(sourceStart + index));
    const view = target.arena.view;
    const begin = target.block.offset + start * codec.size;
    for (let index = 0; index < count; index++) codec.write(view, begin + index * codec.size, read(sourceStart + index));
  } else {
    const values = target.arena.values;
    const begin = target.block.offset / 8 + start;
    for (let index = 0; index < count; index++) values[begin + index] = read(sourceStart + index);
  }
  return destination;
}

/** Fill one scalar, then exponentially copy its exact byte pattern without per-element Proxy access. */
export function fillSpatialRange(spaces, destination, start, count, value) {
  const target = liveBinding(spaces, destination, true);
  if (target.record.kind !== 'array') throw new ManagedFault('ArgumentException', 'A managed array is required');
  range(target.length, start, count);
  if (!count) return destination;
  const data = publicPayload(target);
  if (data !== target.view) {
    target.codec?.validate(value);
    for (let index = 0; index < count; index++) writePublicSlot(target, data, start + index, value);
    return destination;
  }
  if (!target.codec) {
    const begin = target.block.offset / 8 + start;
    target.arena.values.fill(value, begin, begin + count);
    return destination;
  }
  const width = target.codec.size;
  const begin = target.block.offset + start * width;
  target.codec.write(target.arena.view, begin, value);
  const total = width * count;
  const bytes = target.arena.bytes;
  let filled = width;
  while (filled < total) {
    const next = Math.min(filled, total - filled);
    bytes.copyWithin(begin + filled, begin, begin + next);
    filled += next;
  }
  return destination;
}

import {array, integer} from '@sharpforge/bcl-core';
import {count, change, reserve, writeArray} from './legacy-storage.js';

function finish(p, reference, size) {
  p.set(reference, '$count', size);
  change(p, reference);
  return null;
}

function insert(p, reference, index, value) {
  const size = count(p, reference);
  integer(p, index, 0, size);
  reserve(p, reference, size + 1);
  const storage = p.get(reference, '$data');
  const items = p.heap.get(storage).data;
  for (let target = size; target > index; target--) writeArray(p, storage, target, items[target - 1]);
  writeArray(p, storage, index, value);
  return finish(p, reference, size + 1);
}

function addRange(p, reference, source) {
  const items = array(p, source);
  const size = count(p, reference);
  const nextSize = integer(p, size + items.length);
  if (items.length) {
    reserve(p, reference, nextSize);
    const storage = p.get(reference, '$data');
    // The source array remains rooted by invocation even when growth replaces aliased backing storage.
    for (let index = 0; index < items.length; index++) writeArray(p, storage, size + index, items[index]);
  }
  return finish(p, reference, nextSize);
}

/** Validate and reserve before writing; reuse capacity while preserving released successful-call versions. */
export function listInsertion(p, descriptor, context) {
  const {reference, values, native} = context;
  return descriptor.name === 'Insert' ? insert(p, reference, native[0], values[1]) : addRange(p, reference, values[0]);
}

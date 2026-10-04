import {hasBooleanStorage} from '../gc/boolean-storage.js';
import {ManagedFault} from '../gc/fault.js';
import {readPublicSlot, writeRawSlot} from '../gc/spatial-payload.js';
import {storeHostPayload} from '../gc/host-payload-mutation.js';

function booleanBinding(heap, record, index) {
  if (record.kind !== 'array') throw new ManagedFault('ArgumentException', 'Array storage required');
  const binding = heap.spaces.getBinding(record, false);
  if (!Number.isSafeInteger(index) || index < 0 || index >= binding.length) {
    throw new ManagedFault('IndexOutOfRangeException', 'Managed array index exceeds its length');
  }
  return binding;
}

/** Read a CLI array element before opcode signedness is applied; Boolean storage remains an unsigned byte. */
export function readCilArraySlot(heap, record, index) {
  if (!hasBooleanStorage(record)) return record.data[index];
  const binding = booleanBinding(heap, record, index);
  if (record.data !== binding.view) readPublicSlot(binding, index);
  return binding.codec.readRaw(binding.arena.view, binding.block.offset + index);
}

/** Store a CLI Boolean byte already normalized to the declared width, preserving one element publication. */
export function writeCilArraySlot(heap, reference, index, value) {
  const record = heap.get(reference);
  if (!hasBooleanStorage(record)) return heap.writeElement(reference, index, value);
  const binding = booleanBinding(heap, record, index);
  binding.codec.validateRaw(value);
  if (record.data !== binding.view || heap.barriers.onStore) {
    return storeHostPayload(heap.barriers, binding, index, value, {site: 'element', raw: true});
  }
  writeRawSlot(binding, index, value);
  return heap.barriers.publishStore(reference, index, value, 'element', undefined);
}

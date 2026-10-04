import { Reader, text } from '../binary.js';
import { generationError } from './delta-contracts.js';

export const generationHeapKinds = Object.freeze({
  string: '#Strings', blob: '#Blob', guid: '#GUID', userString: '#US',
});
export const generationHeapNames = Object.freeze(Object.values(generationHeapKinds));
const kindsByHeap = Object.freeze(Object.fromEntries(Object.entries(generationHeapKinds).map(([kind, name]) => [name, kind])));

function heapName(name) {
  if (!generationHeapNames.includes(name)) generationError('MD_GEN_HEAP', 'Unknown metadata generation heap');
  return name;
}

function stringHeapSize(data, operation) {
  let end = data.length - 1;
  while (end >= 0 && data[end] === 0) {
    if ((end & 1023) === 0) operation.check();
    end--;
  }
  // SRM keeps the final terminator but removes alignment zeros; an absent heap stays absent.
  return data.length && end < data.length - 1 ? end + 2 : data.length;
}

/** Preserve physical GUID slots, including holes; only logical #Strings extent trims alignment. */
export function generationHeapState(metadata, previous, operation) {
  const heapSizes = {}, heapTotals = {};
  for (const name of generationHeapNames) {
    operation.check();
    const data = metadata.streams.get(name) ?? new Uint8Array();
    if (name === '#GUID' ? data.length % 16 : data.length && data[0] !== 0) {
      generationError('MD_GEN_FORMAT', 'Invalid CLI heap alignment or nil entry');
    }
    const size = name === '#Strings' ? stringHeapSize(data, operation) : data.length;
    heapSizes[name] = size;
    heapTotals[name] = (previous?.heapTotals[name] ?? 0) + (name === '#GUID' ? size / 16 : size);
  }
  return { heapSizes, heapTotals };
}

/** Match SRM heap introduction mapping; a mapped GUID slot can still fail physical dereference. */
export function mapGenerationHeap(entries, name, value, generation) {
  heapName(name);
  const maximum = name === '#US' ? 0xffffff : 0xffffffff;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) generationError('MD_GEN_HEAP', 'Invalid heap handle');
  const position = name === '#GUID' ? value - 1 : value;
  if (position >= entries[generation].heapTotals[name]) generationError('MD_GEN_HEAP', 'Heap handle belongs to a future generation');
  let low = 0, high = generation;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle].heapTotals[name] > position) high = middle;
    else low = middle + 1;
  }
  const localValue = name === '#GUID' || low === 0 ? value : value - entries[low - 1].heapTotals[name];
  return { kind: kindsByHeap[name], value, generation: low, localValue };
}

function physicalHeap(entries, name, mapping) {
  const entry = entries[mapping.generation], data = entry.metadata.streams.get(name);
  const index = mapping.localValue, offset = name === '#GUID' ? (index - 1) * 16 : index;
  if (!data || offset < 0 || offset >= entry.heapSizes[name] || (name === '#GUID' && offset + 16 > data.length)) {
    generationError('MD_GEN_HEAP', 'Mapped heap handle has no readable physical slot');
  }
  return { entry, data, index, offset };
}

/** Scalar admission does not decode/cache every string or reinterpret signature payloads. */
export function validateGenerationHeapReference(entries, name, value, generation) {
  if (value === 0) return;
  const mapping = mapGenerationHeap(entries, name, value, generation);
  const physical = physicalHeap(entries, name, mapping);
  if (name === '#Blob') {
    const reader = new Reader(physical.data, physical.offset);
    reader.need(reader.compressed());
  }
}

function heapExtent(physical, name, operation) {
  const { data, offset, entry } = physical;
  if (name === '#GUID') {
    operation.checkEntry(16);
    return { offset, payloadOffset: offset, payloadBytes: 16, bytes: 16 };
  }
  if (name === '#Strings') {
    let end = offset;
    while (end < entry.heapSizes[name] && data[end]) {
      if (((end - offset) & 127) === 0) operation.checkEntry(end - offset + 1);
      end++;
    }
    if (end === entry.heapSizes[name]) generationError('MD_GEN_HEAP', 'Unterminated generation string');
    operation.checkEntry(end - offset + 1);
    return { offset, payloadOffset: offset, payloadBytes: end - offset, bytes: end - offset + 1 };
  }
  const reader = new Reader(data, offset), payloadBytes = reader.compressed();
  reader.need(payloadBytes);
  const bytes = reader.position - offset + payloadBytes;
  operation.checkEntry(bytes);
  if (name === '#US' && (!payloadBytes || !(payloadBytes & 1))) generationError('MD_GEN_HEAP', 'Invalid generation user string');
  return { offset, payloadOffset: reader.position, payloadBytes, bytes };
}

function nilHeap(name, operation) {
  const value = name === '#GUID' ? new Uint8Array(16) : name === '#Blob' ? new Uint8Array() : name === '#Strings' ? '' : null;
  operation.charge(name === '#GUID' ? 16 : 0);
  return { heap: name, index: 0, generation: null, localIndex: 0, isNil: true,
    sourceOffset: null, byteLength: 0, payloadByteLength: 0, value };
}

/** Decode through the existing UTF-8, blob, GUID and user-string codecs after bounding the requested extent. */
export function generationHeapEntry(entries, name, index, generation, operation) {
  heapName(name);
  if (index === 0) return nilHeap(name, operation);
  const mapping = mapGenerationHeap(entries, name, index, generation);
  const physical = physicalHeap(entries, name, mapping);
  try {
    const extent = heapExtent(physical, name, operation);
    operation.charge(extent.bytes);
    const { entry, data } = physical;
    let value;
    // Querying arbitrary string suffixes must not fill readMetadata's persistent string cache.
    if (name === '#Strings') value = text(data.subarray(extent.payloadOffset, extent.payloadOffset + extent.payloadBytes));
    else if (name === '#Blob') value = new Uint8Array(entry.metadata.blob(mapping.localValue));
    else if (name === '#GUID') value = entry.metadata.guid(mapping.localValue);
    else value = entry.metadata.userString(0x70000000 + mapping.localValue);
    operation.check();
    return { heap: name, index, generation: mapping.generation, localIndex: mapping.localValue, isNil: false,
      sourceOffset: data.byteOffset - entry.bytes.byteOffset + extent.offset,
      byteLength: extent.bytes, payloadByteLength: extent.payloadBytes, value };
  } catch (error) {
    if (error.code?.startsWith('MD_GEN_')) throw error;
    generationError('MD_GEN_HEAP', 'Invalid generation heap record', error);
  }
}

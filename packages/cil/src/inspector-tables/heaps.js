import { CilError, Reader } from '../binary.js';
import { tableInteger } from './budget.js';

export const tableHeapNames = Object.freeze(['#Strings', '#Blob', '#GUID', '#US']);
const guidOrder = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];

function guidDisplay(bytes) {
  const hex = guidOrder.map(index => bytes[index].toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function tableHeap(context, name) {
  if (!tableHeapNames.includes(name)) throw new CilError('Unknown metadata heap');
  return context.streams.get(name);
}

function nilHeapEntry(name) {
  const value = name === '#Strings' ? '' : name === '#US' ? null : name === '#GUID' ? new Uint8Array(16) : new Uint8Array();
  return { heap: name, index: 0, offset: null, fileOffset: null, metadataOffset: null, byteLength: 0,
    payloadFileOffset: null, payloadByteLength: 0, isNil: true, value,
    ...(name === '#GUID' ? { display: guidDisplay(value) } : {}) };
}

function entryExtent(heap, name, offset, budget) {
  if (name === '#GUID') {
    if (offset % 16) throw new CilError('GUID heap byte offset is not aligned');
    new Reader(heap.data, offset).need(16);
    budget.checkEntry(16);
    return { payloadOffset: offset, payloadBytes: 16, bytes: 16 };
  }
  if (name === '#Strings') {
    let end = offset;
    while (end < heap.data.length && heap.data[end] !== 0) {
      if (((end - offset) & 127) === 0) budget.checkEntry(end - offset + 1);
      end++;
    }
    if (end === heap.data.length) throw new CilError('Unterminated metadata string');
    budget.checkEntry(end - offset + 1);
    return { payloadOffset: offset, payloadBytes: end - offset, bytes: end - offset + 1 };
  }
  const reader = new Reader(heap.data, offset), payloadBytes = reader.compressed();
  reader.need(payloadBytes);
  const bytes = reader.position - offset + payloadBytes;
  budget.checkEntry(bytes);
  if (name === '#US' && payloadBytes && !(payloadBytes & 1))
    throw new CilError('Invalid UTF-16 user string');
  return { payloadOffset: reader.position, payloadBytes, bytes };
}

/** Bound the encoded extent first; existing metadata heap accessors own every value decoder. */
export function tableHeapEntry(context, name, index, budget, physical = false) {
  const heap = tableHeap(context, name);
  tableInteger(index, 'heap index', 0xffffffff);
  if ((name === '#GUID' && index === 0) || (!heap && index === 0)) return nilHeapEntry(name);
  if (!heap) throw new CilError('Metadata heap is absent');
  if (index === 0 && heap.data[0] !== 0) throw new CilError('Invalid metadata heap nil entry');
  const offset = name === '#GUID' ? (index - 1) * 16 : index;
  if (offset >= heap.data.length) throw new CilError('Metadata heap index is outside the stream');
  const extent = entryExtent(heap, name, offset, budget);
  // Zero bytes between physical user-string records/past the last record are padding,
  // not valid ldstr handles. Direct lookup retains the existing decoder's rejection.
  const isPadding = name === '#US' && index !== 0 && extent.payloadBytes === 0;
  if (isPadding && !physical) throw new CilError('Invalid UTF-16 user string');
  budget.charge(extent.bytes);
  const metadata = context.metadata;
  let value;
  try {
    if (name === '#Strings') value = metadata.string(index);
    else if (name === '#Blob') value = new Uint8Array(metadata.blob(index));
    else if (name === '#GUID') value = metadata.guid(index);
    else if (extent.payloadBytes === 0) value = null;
    else {
      if (index > 0xffffff) throw new CilError('User-string offset exceeds the token range');
      value = metadata.userString(0x70000000 + index);
    }
  } catch (error) {
    if (error instanceof CilError) throw error;
    throw new CilError(`Invalid metadata heap value: ${error.message}`);
  }
  return { heap: name, index, offset, fileOffset: heap.fileOffset + offset,
    metadataOffset: heap.metadataOffset + offset, byteLength: extent.bytes,
    payloadFileOffset: heap.fileOffset + extent.payloadOffset, payloadByteLength: extent.payloadBytes,
    isNil: index === 0, value, ...(name === '#GUID' ? { display: guidDisplay(value) } : {}),
    ...(name === '#US' ? { token: isPadding ? null : index ? 0x70000000 + index : 0, isPadding,
      terminalMarker: extent.payloadBytes ? heap.data[extent.payloadOffset + extent.payloadBytes - 1] : null } : {}) };
}

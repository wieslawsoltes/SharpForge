import {encodeWorkspaceFile} from '@sharpforge/archive';
import {workspaceRecordSource} from './transaction-records.js';

const CHUNK_CHARACTERS = 64 * 1024;

/** Encode snapshot ranges with complete surrogate pairs; never read or cache the full compatibility text view. */
export function* workspaceRecordByteChunks(record, {maxBytes = 320 * 1024 * 1024} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('SFW1102: Invalid encoded source byte budget');
  const source = workspaceRecordSource(record);
  if (!source) {
    const bytes = encodeWorkspaceFile(record);
    if (bytes.length > maxBytes) throw new RangeError('SFW1102: Encoded record exceeds the byte budget');
    yield bytes;
    return;
  }
  if (source.length > maxBytes * 2) {
    throw new RangeError('SFW1102: Encoded source exceeds the byte budget');
  }
  if (record.bytes && record.originalSource === source) {
    if (record.bytes.length > maxBytes) throw new RangeError('SFW1102: Encoded source exceeds the byte budget');
    yield record.bytes;
    return;
  }
  let total = 0;
  let start = 0;
  let first = true;
  do {
    let end = Math.min(source.length, start + CHUNK_CHARACTERS);
    if (end < source.length) {
      const pair = source.getText(end - 1, end + 1);
      if (pair.charCodeAt(0) >= 0xd800 && pair.charCodeAt(0) <= 0xdbff
          && pair.charCodeAt(1) >= 0xdc00 && pair.charCodeAt(1) <= 0xdfff) end++;
    }
    const bytes = encodeWorkspaceFile({path: record.path, text: source.getText(start, end),
      encoding: record.encoding, bom: first && record.bom});
    total += bytes.length;
    if (total > maxBytes) throw new RangeError('SFW1102: Encoded source exceeds the byte budget');
    yield bytes;
    start = end;
    first = false;
  } while (start < source.length);
}

/** Physical provider writes explicitly materialize bounded encoded bytes, without flattening the source snapshot. */
export function encodedWorkspaceRecordBytes(record, options) {
  const parts = [...workspaceRecordByteChunks(record, options)];
  if (parts.length === 1) return parts[0];
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

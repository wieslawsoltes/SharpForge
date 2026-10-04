import { Reader, CilError, align } from './binary.js';

/** Rebuild only the stream directory and #US bytes, preserving every other stream verbatim. */
export function appendDocumentMetadata(pe, userStrings, data) {
  if (!userStrings) return { offset: pe.metadataOffset, size: pe.metadataDirectory.size, tableOffset: pe.metadata.tableOffset };
  const streams = [...pe.metadata.streams];
  const userIndex = streams.findIndex(([name]) => name === '#US');
  if (userIndex < 0) streams.push(['#US', userStrings]);
  else streams[userIndex] = ['#US', userStrings];
  if (streams.length > 32) throw new CilError('Too many metadata streams for a new #US heap');
  const original = pe.bytes.subarray(pe.metadataOffset, pe.metadataOffset + pe.metadataDirectory.size);
  const reader = new Reader(original);
  reader.take(12);
  const versionSize = reader.u32();
  reader.take(versionSize);
  reader.u16();
  const prefixSize = reader.position;
  let capacity = prefixSize + 2;
  for (const [name] of streams) capacity = align(capacity + 8 + name.length + 1);
  for (const [, bytes] of streams) capacity = align(capacity) + bytes.length;
  if (capacity > 64 * 1024 * 1024) throw new CilError('Rebuilt metadata size limit exceeded');
  data.pad(4);
  const offset = data.length;
  data.bytes(original.subarray(0, prefixSize)).u16(streams.length);
  const headers = [];
  for (const [name, bytes] of streams) {
    headers.push(data.length);
    data.u32(0).u32(bytes.length);
    for (let index = 0; index < name.length; index++) data.u8(name.charCodeAt(index));
    data.u8(0).pad();
  }
  let tableOffset;
  const tableName = pe.metadata.uncompressed ? '#-' : '#~';
  for (let index = 0; index < streams.length; index++) {
    data.pad();
    data.patch32(headers[index], data.length - offset);
    const [name, bytes] = streams[index];
    if (name === tableName) tableOffset = data.length - offset;
    data.bytes(bytes);
  }
  return { offset, size: data.length - offset, tableOffset };
}

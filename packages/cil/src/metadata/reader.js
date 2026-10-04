import { Reader, CilError, align, text } from '../binary.js';
import { readMetadataTables } from './table-stream.js';
import { metadataList } from './pointer-tables.js';
import { MetadataTypeNames } from './type-names.js';
import { readUserString } from './user-strings.js';
import { MetadataReadBudget } from './reader-budget.js';

function readStreams(reader, bytes, budget) {
  const count = reader.u16();
  if (count > 32) throw new CilError('Too many metadata streams');
  const streams = new Map(), ranges = [];
  for (let index = 0; index < count; index++) {
    budget?.check();
    const offset = reader.u32(), size = reader.u32();
    let name = '';
    for (let character = 0; character < 32; character++) {
      const value = reader.u8();
      if (!value) break;
      name += String.fromCharCode(value);
      if (character === 31) throw new CilError('Invalid stream name');
    }
    reader.position = align(reader.position);
    if (offset + size > bytes.length || streams.has(name)) throw new CilError('Invalid or duplicate metadata stream');
    streams.set(name, bytes.subarray(offset, offset + size));
    ranges.push([offset, offset + size]);
  }
  for (let index = 0; index < ranges.length; index++) {
    if (ranges[index][0] < reader.position) throw new CilError('Metadata stream overlaps its header');
    for (let previous = 0; previous < index; previous++) {
      if (ranges[index][0] < ranges[previous][1] && ranges[previous][0] < ranges[index][1]) {
        throw new CilError('Overlapping metadata streams');
      }
    }
  }
  return streams;
}

/** Read physical CLI metadata; optional row bounds apply before row allocation and cancellation is synchronous. */
export function readMetadata(bytes, options = undefined) {
  const budget = options === undefined ? undefined : new MetadataReadBudget(options);
  const reader = new Reader(bytes);
  if (reader.u32() !== 0x424a5342) throw new CilError('Invalid CLI metadata signature');
  reader.u16();
  reader.u16();
  reader.u32();
  const versionLength = reader.u32();
  if (versionLength > 256) throw new CilError('Metadata version string is too long');
  const version = text(reader.take(versionLength)).replace(/\0+$/, '');
  reader.u16();
  const streams = readStreams(reader, bytes, budget);
  const tableData = readMetadataTables(streams, bytes, budget);
  const { rows } = tableData;
  const strings = streams.get('#Strings') ?? new Uint8Array([0]);
  const blobs = streams.get('#Blob') ?? new Uint8Array([0]);
  const userStrings = streams.get('#US') ?? new Uint8Array([0]);
  const stringCache = new Map();
  const typeNames = new MetadataTypeNames();
  budget?.check();
  return {
    version, streams, ...tableData,
    list(owner, column) { return metadataList(this, owner, column); },
    guid(index) {
      const data = streams.get('#GUID') ?? new Uint8Array();
      if (index === 0) return new Uint8Array(16);
      if (!Number.isInteger(index) || index < 1 || index * 16 > data.length) throw new CilError('Invalid GUID heap index');
      return new Uint8Array(data.subarray((index - 1) * 16, index * 16));
    },
    row(value) {
      const row = rows[value >>> 24]?.[(value & 0xffffff) - 1];
      if (!row) throw new CilError(`Invalid metadata token 0x${value.toString(16)}`);
      return row;
    },
    string(index) {
      if (stringCache.has(index)) return stringCache.get(index);
      if (index >= strings.length) throw new CilError('Invalid string heap index');
      let end = index;
      while (end < strings.length && strings[end]) end++;
      if (end === strings.length) throw new CilError('Unterminated metadata string');
      const value = text(strings.subarray(index, end));
      stringCache.set(index, value);
      return value;
    },
    blob(index) {
      if (index >= blobs.length) throw new CilError('Invalid blob heap index');
      const reader = new Reader(blobs, index);
      return reader.take(reader.compressed());
    },
    userString(value) { return readUserString(userStrings, value); },
    typeName(value, depth = 0) { return typeNames.read(this, value, depth); },
  };
}

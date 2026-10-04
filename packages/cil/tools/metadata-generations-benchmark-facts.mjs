import assert from 'node:assert/strict';
import { sha } from '../../../scripts/conformance/perf/core.js';

/** Stable data projection preserves undefined, BigInt, function arity, Map order and all byte contents. */
export function dataFacts(value) {
  if (value === undefined) return { valueType: 'undefined' };
  if (typeof value === 'bigint') return { valueType: 'bigint', value: value.toString() };
  if (typeof value === 'function') return { valueType: 'function', arity: value.length };
  if (value instanceof Uint8Array) return { valueType: 'bytes', length: value.length, sha256: sha(value) };
  if (value instanceof Map) return { valueType: 'Map', entries: [...value].map(dataFacts) };
  if (Array.isArray(value)) return value.map(dataFacts);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dataFacts(item)]));
  return value;
}

const outcome = action => {
  try { return { status: 'returned', value: dataFacts(action()) }; }
  catch (error) { return { status: 'threw', name: error.name, code: dataFacts(error.code), message: error.message }; }
};

function heapFacts(api, metadata) {
  const references = { str: new Set([0]), blob: new Set([0]), guid: new Set([0]) };
  for (const [table, rows] of Object.entries(metadata.rows)) for (const row of rows) {
    row.forEach((value, column) => references[api.metadataSchemas[table][column]]?.add(value));
  }
  const result = {};
  for (const [kind, values] of Object.entries(references)) {
    const read = { str: 'string', blob: 'blob', guid: 'guid' }[kind];
    result[kind] = [...values].sort((a, b) => a - b).map(value => [value, outcome(() => metadata[read](value))]);
  }
  result.userString = [0x70000000, 0x70000001].map(value => [value, outcome(() => metadata.userString(value))]);
  return result;
}

function ownershipFacts(api, input) {
  const bytes = new Uint8Array(input), metadata = api.readMetadata(bytes);
  const streamsBorrowInput = [...metadata.streams].every(([, stream]) => stream.buffer === bytes.buffer);
  assert.equal(streamsBorrowInput, true, 'Ordinary physical reader streams remain borrowed');
  const first = metadata.guid(1), expected = first.slice();
  assert.notEqual(first.buffer, bytes.buffer, 'GUID getter returns a copy');
  first[0] ^= 1;
  assert.deepEqual(metadata.guid(1), expected, 'GUID getter output is independently owned');
  const blob = metadata.blob(0);
  assert.equal(blob.buffer, bytes.buffer, 'Blob getter retains borrowed-view semantics, including nil');
  const rowsBorrowTableArrays = Object.entries(metadata.rows).every(([table, rows]) =>
    rows.every((row, index) => metadata.row(Number(table) * 0x1000000 + index + 1) === row));
  assert.equal(rowsBorrowTableArrays, true, 'Ordinary row getter retains row-array identity');
  return { streamsBorrowInput, guidCopies: true, blobBorrowsInput: true, rowsBorrowTableArrays };
}

export function metadataFacts(api, bytes) {
  const metadata = api.readMetadata(bytes);
  const lists = [], names = [];
  for (const [table, columns] of [[2, ['FieldList', 'MethodList']], [6, ['ParamList']], [18, ['EventList']], [21, ['PropertyList']]]) {
    for (let row = 1; row <= (metadata.counts[table] ?? 0); row++) for (const column of columns) {
      const token = table * 0x1000000 + row;
      lists.push({ token, column, result: outcome(() => metadata.list(token, column)) });
    }
  }
  for (const table of [1, 2, 27]) for (let row = 1; row <= (metadata.counts[table] ?? 0); row++) {
    const token = table * 0x1000000 + row;
    names.push({ token, result: outcome(() => metadata.typeName(token)) });
  }
  return { raw: dataFacts(metadata), keys: Object.keys(metadata), heaps: heapFacts(api, metadata), lists, names,
    ownership: ownershipFacts(api, bytes), rowCount: Object.values(metadata.counts).reduce((sum, count) => sum + count, 0) };
}

export function peFacts(api, bytes) {
  const pe = api.readPE(bytes), bodies = [];
  for (let row = 1; row <= (pe.metadata.counts[6] ?? 0); row++) {
    const token = 0x06000000 + row;
    bodies.push({ token, result: outcome(() => pe.methodBody(token)) });
  }
  return { raw: dataFacts(pe), keys: Object.keys(pe), bodies,
    offsets: pe.sections.map(section => pe.offsetOf(section.rva, section.size)), inputIdentity: pe.bytes === bytes,
    metadata: metadataFacts(api, bytes.subarray(pe.metadataOffset, pe.metadataOffset + pe.metadataDirectory.size)) };
}

export function guardReader(value, expected, bytes, kind) {
  assert.deepEqual(dataFacts(value), expected.raw, 'Every timed reader data field');
  assert.deepEqual(Object.keys(value), expected.keys, 'Public reader field order');
  const metadata = kind === 'pe' ? value.metadata : value;
  assert.ok([...metadata.streams.values()].every(stream => stream.buffer === bytes.buffer), 'Timed borrowed heap buffers');
  if (kind === 'pe') assert.equal(value.bytes, bytes, 'Timed PE input identity');
}

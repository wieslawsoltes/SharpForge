import assert from 'node:assert/strict';
import test from 'node:test';
import { MetadataGenerations, metadataSchemas, readMetadata } from '@sharpforge/cil';
import { cliGenerationFixture, editCliDelta } from './support/cli-metadata-delta.js';

function rejectedDelta(edit, code) {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  const row = reader.row(0x06000001), bytes = reader.retainedBytes, records = reader.retainedRecords;
  assert.throws(() => reader.append(editCliDelta(fixture.deltas[0].bytes, edit), { generation: 1 }), { code });
  assert.equal(reader.generation, 0);
  assert.equal(reader.retainedBytes, bytes);
  assert.equal(reader.retainedRecords, records);
  assert.deepEqual(reader.row(0x06000001), row);
  reader.append(fixture.deltas[0].bytes, { generation: 1 });
  assert.equal(reader.generation, 1);
}

test('malformed EncMap rejection leaves every prior generation fact intact', () => {
  const edits = [
    rows => rows[31].reverse(),
    rows => rows[31][1] = [...rows[31][0]],
    rows => rows[31][1][0] = 0x06000003,
    rows => rows[31][0][0] = 0x06000000,
    rows => rows[31].push([0x30000001]),
    rows => rows[31].push([0x1f000001]),
    rows => rows[31].push([0x2b000001]),
    rows => rows[31].pop(),
    rows => rows[6].push([...rows[6][0]]),
    rows => rows[31].unshift([2]),
  ];
  for (const edit of edits) rejectedDelta(edit, 'MD_GEN_MAP');
});

test('raw delta admission rejects format, identity and unavailable aggregate references', () => {
  rejectedDelta(rows => { delete rows[0]; }, 'MD_GEN_FORMAT');
  rejectedDelta((rows, heaps, options) => { options.tableStream = '#~'; }, 'MD_GEN_FORMAT');
  rejectedDelta((rows, heaps, options) => { options.marker = new Uint8Array([0]); }, 'MD_GEN_FORMAT');
  rejectedDelta(rows => { rows[0][0][0] = 2; }, 'MD_GEN_IDENTITY');
  rejectedDelta(rows => { rows[0][0][1] = 0; }, 'MD_GEN_IDENTITY');
  rejectedDelta((rows, heaps) => {
    heaps.find(([name]) => name === '#GUID')[1][(rows[0][0][2] - 1) * 16] ^= 1;
  }, 'MD_GEN_IDENTITY');
  rejectedDelta((rows, heaps) => {
    const start = (rows[0][0][3] - 1) * 16;
    heaps.find(([name]) => name === '#GUID')[1].fill(0, start, start + 16);
  }, 'MD_GEN_IDENTITY');
  rejectedDelta(rows => { rows[0][0][4] = rows[0][0][3]; }, 'MD_GEN_IDENTITY');
  rejectedDelta(rows => { rows[6][0][4] = 0xffffffff; }, 'MD_GEN_REFERENCE');
  rejectedDelta(rows => { rows[6][0][5] = 0xffffff; }, 'MD_GEN_REFERENCE');
  rejectedDelta(rows => {
    rows[1] = [[6, 0, 0]];
    rows[31].unshift([0x01000001]);
  }, 'MD_GEN_REFERENCE');
  rejectedDelta((rows, heaps) => { heaps.find(([name]) => name === '#Blob')[1][0] = 1; }, 'MD_GEN_FORMAT');
});

test('generation order, prior IDs and baseline admission are explicit', () => {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  const snapshot = () => ({ generation: reader.generation, identity: reader.identity, counts: reader.counts,
    retainedBytes: reader.retainedBytes, retainedRecords: reader.retainedRecords, heaps: reader.heaps(),
    tables: reader.tables({ includeEmpty: false }).map(({ table }) => reader.rows(table)) });
  const baseline = snapshot();
  assert.throws(() => new MetadataGenerations(fixture.deltas[0].bytes), { code: 'MD_GEN_FORMAT' });
  assert.throws(() => reader.append(fixture.deltas[1].bytes, { generation: 1 }), { code: 'MD_GEN_IDENTITY' });
  assert.deepEqual(snapshot(), baseline, 'Rejected physical ordinal leaves every retained baseline fact unchanged');
  assert.throws(() => reader.append(fixture.deltas[0].bytes, { generation: 2 }), { code: 'MD_GEN_IDENTITY' });
  assert.deepEqual(snapshot(), baseline, 'Rejected caller ordinal leaves every retained baseline fact unchanged');
  reader.append(fixture.deltas[0].bytes, { generation: 1 });
  const wrongPrevious = editCliDelta(fixture.deltas[1].bytes, (rows, heaps) => {
    heaps.find(([name]) => name === '#GUID')[1][(rows[0][0][4] - 1) * 16] ^= 1;
  });
  assert.throws(() => reader.append(wrongPrevious, { generation: 2 }), { code: 'MD_GEN_IDENTITY' });
  assert.equal(reader.generation, 1);
  reader.append(fixture.deltas[1].bytes, { generation: 2 });
  assert.equal(reader.generation, 2);
});

test('retention limits reject before exposing partial generations', () => {
  const fixture = cliGenerationFixture(), recordCount = Object.values(fixture.metadata.counts).reduce((sum, count) => sum + count, 0);
  assert.throws(() => new MetadataGenerations(fixture.baseline, { maxInputBytes: 1 }), { code: 'MD_GEN_BUDGET' });
  assert.throws(() => new MetadataGenerations(fixture.baseline, { maxRetainedRecords: recordCount - 1 }), { code: 'MD_GEN_BUDGET' });
  for (const options of [
    { maxGenerations: 1 },
    { maxRetainedRecords: recordCount },
    { maxRetainedBytes: fixture.baseline.length + fixture.deltas[0].bytes.length - 1 },
  ]) {
    const reader = new MetadataGenerations(fixture.baseline, options);
    assert.throws(() => reader.append(fixture.deltas[0].bytes, { generation: 1 }), { code: 'MD_GEN_BUDGET' });
    assert.equal(reader.generation, 0);
    assert.equal(reader.retainedBytes, fixture.baseline.length);
  }
});

test('cancellation before copying and after physical parsing preserves the previous history', () => {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  assert.throws(() => new MetadataGenerations(fixture.baseline, { signal: AbortSignal.abort() }), { code: 'MD_GEN_CANCELED' });
  assert.throws(() => reader.append(fixture.deltas[0].bytes, { generation: 1, signal: AbortSignal.abort() }), { code: 'MD_GEN_CANCELED' });
  let checks = 0;
  const signal = { get aborted() { return ++checks > 25; } };
  assert.throws(() => reader.append(fixture.deltas[0].bytes, { generation: 1, signal }), { code: 'MD_GEN_CANCELED' });
  assert.ok(checks > 25);
  assert.equal(reader.generation, 0);
  reader.append(fixture.deltas[0].bytes, { generation: 1 });
  assert.equal(reader.generation, 1);
  assert.throws(() => reader.rows(6, { signal: AbortSignal.abort() }), { code: 'MD_GEN_CANCELED' });
  assert.throws(() => reader.heapEntry('#GUID', 1, { signal: { aborted: 'true' } }), { code: 'MD_GEN_INPUT' });
});

test('query bounds, nil entities, unsupported handles and control identities stay distinct', () => {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  assert.deepEqual(reader.getGenerationHandle({ kind: 'entity', value: 0x06000000 }),
    { kind: 'entity', value: 0x06000000, generation: 0, localValue: 0x06000000 });
  for (const value of [0x06000000, 0x06000002, -1, 0xffffffff, 1.5]) {
    assert.throws(() => reader.row(value), { code: 'MD_GEN_TOKEN' });
  }
  assert.throws(() => reader.getGenerationHandle({ kind: 'virtual', value: 1 }), { code: 'MD_GEN_FORMAT' });
  assert.throws(() => reader.rows(31), { code: 'MD_GEN_CONTROL' });
  assert.throws(() => reader.getAggregateToken(0x1e000001, 0), { code: 'MD_GEN_CONTROL' });
  assert.throws(() => reader.row(1, { generation: null }), { code: 'MD_GEN_INPUT' });
  assert.throws(() => reader.rows(6, { limit: 1001 }), { code: 'MD_GEN_INPUT' });
  assert.throws(() => reader.row(1, { maxPageBytes: 0 }), { code: 'MD_GEN_BUDGET' });
  assert.throws(() => reader.heapEntry('#GUID', 1, { maxEntryBytes: 15 }), { code: 'MD_GEN_BUDGET' });
  for (const name of ['#Strings', '#Blob', '#GUID', '#US']) {
    assert.throws(() => reader.heapEntry(name, 0xffffffff), { code: 'MD_GEN_HEAP' });
  }
  if (typeof SharedArrayBuffer !== 'undefined') {
    assert.throws(() => new MetadataGenerations(new Uint8Array(new SharedArrayBuffer(8))), { code: 'MD_GEN_INPUT' });
  }
});

test('signal callbacks cannot publish a reentrant append or revive a disposed history', () => {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  let nested = false;
  const signal = { get aborted() {
    if (!nested) {
      nested = true;
      assert.throws(() => reader.append(fixture.deltas[0].bytes, { generation: 1 }), { code: 'MD_GEN_INPUT' });
    }
    return false;
  } };
  reader.append(fixture.deltas[0].bytes, { generation: 1, signal });
  assert.equal(reader.generation, 1);
  let disposed = false;
  const disposeSignal = { get aborted() {
    if (!disposed) { disposed = true; reader.dispose(); }
    return false;
  } };
  assert.throws(() => reader.append(fixture.deltas[1].bytes, { generation: 2, signal: disposeSignal }), { code: 'MD_GEN_DISPOSED' });
  assert.throws(() => reader.generation, { code: 'MD_GEN_DISPOSED' });
});

test('a generation getter cannot publish a nested append before the outer commit', () => {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  const row = reader.row(0x06000001), bytes = reader.retainedBytes, records = reader.retainedRecords;
  let reads = 0;
  const options = { get generation() {
    reads++;
    assert.equal(reader.generation, 0);
    assert.throws(() => reader.append(fixture.deltas[0].bytes, { generation: 1 }), { code: 'MD_GEN_INPUT' });
    assert.equal(reader.generation, 0);
    assert.equal(reader.retainedBytes, bytes);
    assert.equal(reader.retainedRecords, records);
    assert.deepEqual(reader.row(0x06000001), row);
    return 1;
  } };
  assert.equal(reader.append(fixture.deltas[0].bytes, options), 1);
  assert.equal(reads, 1);
  assert.equal(reader.generation, 1);
});

test('input extents and copying ignore Uint8Array subclass getters and species', () => {
  const fixture = cliGenerationFixture();
  class GuardedBytes extends Uint8Array {
    get byteLength() { throw new Error('caller byteLength'); }
    get byteOffset() { throw new Error('caller byteOffset'); }
    get length() { throw new Error('caller length'); }
    get buffer() { throw new Error('caller buffer'); }
    static get [Symbol.species]() { throw new Error('caller species'); }
  }
  const input = new GuardedBytes(fixture.baseline);
  Object.defineProperty(input, 'constructor', { get() { throw new Error('caller constructor'); } });
  assert.throws(() => new MetadataGenerations(input, { maxInputBytes: 1 }), { code: 'MD_GEN_BUDGET' });
  const reader = new MetadataGenerations(input);
  assert.equal(reader.retainedBytes, fixture.baseline.length);
  reader.append(new GuardedBytes(fixture.deltas[0].bytes), { generation: 1 });
  assert.equal(reader.generation, 1);
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get) {
    const buffer = new ArrayBuffer(fixture.baseline.length, { maxByteLength: fixture.baseline.length + 1 });
    new Uint8Array(buffer).set(fixture.baseline);
    assert.throws(() => new MetadataGenerations(new Uint8Array(buffer)), { code: 'MD_GEN_INPUT' });
  }
});

test('detached input rejection is transactional before and during copying', () => {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  const detached = fixture.baseline.slice();
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.throws(() => new MetadataGenerations(detached), { code: 'MD_GEN_INPUT' });
  const input = new Uint8Array(131072);
  input.set(fixture.deltas[0].bytes);
  let checks = 0;
  const signal = { get aborted() {
    if (++checks === 5) structuredClone(input.buffer, { transfer: [input.buffer] });
    return false;
  } };
  assert.throws(() => reader.append(input, { generation: 1, signal }), { code: 'MD_GEN_INPUT' });
  assert.equal(checks, 5);
  assert.equal(reader.generation, 0);
  assert.equal(reader.retainedBytes, fixture.baseline.length);
  reader.append(fixture.deltas[0].bytes, { generation: 1 });
  assert.equal(reader.generation, 1);
});

test('logical strings ignore added alignment bytes and skip a generation with no string payload', () => {
  const fixture = cliGenerationFixture();
  const padded = editCliDelta(fixture.deltas[0].bytes, (rows, heaps) => {
    const heap = heaps.find(([name]) => name === '#Strings');
    const bytes = new Uint8Array(heap[1].length + 7);
    bytes.set(heap[1]);
    heap[1] = bytes;
  });
  const reader = new MetadataGenerations(fixture.baseline);
  reader.append(padded, { generation: 1 });
  reader.append(fixture.deltas[1].bytes, { generation: 2 });
  assert.equal(reader.heapEntry('#Strings', reader.row(0x06000003).values[3]).value, 'AddedAgain');
  const strings = reader.heaps().find(heap => heap.heap === '#Strings');
  assert.equal(strings.segments[1].physicalBytes - strings.segments[1].logicalBytes, 7);

  const emptyFirst = editCliDelta(fixture.deltas[0].bytes, (rows, heaps) => {
    heaps.find(([name]) => name === '#Strings')[1] = new Uint8Array();
    rows[0][0][1] = fixture.metadata.rows[0][0][1];
    for (const row of rows[6]) row[3] = fixture.metadata.rows[6][0][3];
    rows[26][0][0] = fixture.metadata.rows[26][0][0];
  });
  const removed = readMetadata(fixture.deltas[0].bytes).streams.get('#Strings').length;
  const shiftedSecond = editCliDelta(fixture.deltas[1].bytes, rows => {
    for (const [table, records] of Object.entries(rows)) for (const row of records) {
      row.forEach((value, column) => { if (metadataSchemas[table][column] === 'str' && value) row[column] -= removed; });
    }
  });
  const empty = new MetadataGenerations(fixture.baseline);
  empty.append(emptyFirst, { generation: 1 });
  empty.append(shiftedSecond, { generation: 2 });
  const start = fixture.metadata.streams.get('#Strings').length;
  assert.equal(empty.getGenerationHandle({ kind: 'string', value: start }).generation, 2);
  assert.equal(empty.heapEntry('#Strings', empty.row(0x06000003).values[3]).value, 'AddedAgain');
});

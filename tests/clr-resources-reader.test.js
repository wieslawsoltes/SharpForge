import test from 'node:test';
import assert from 'node:assert/strict';
import { Writer } from '@sharpforge/cil';
import { ManagedResourceReader, ResourceTypeCode, LoadErrorCode } from '../packages/clr/src/index.js';
import { resourceImage, resourceString, primitiveResourceImage } from './clr-resources-fixtures.js';

test('resources retain native type codes, Unicode/BOMs, exact scalars and caller-owned byte payloads', () => {
  const fixture = primitiveResourceImage();
  const reader = new ManagedResourceReader(fixture.bytes);
  fixture.bytes.fill(0);
  assert.equal(reader.count, 6);
  assert.ok(Object.isFrozen(reader.names));
  assert.equal(reader.header.version, 2);
  const answer = reader.get('answer');
  assert.deepEqual(answer, { typeCode: ResourceTypeCode.Int32, typeName: 'ResourceTypeCode.Int32', value: 42, diagnostic: null });
  assert.equal(reader.get('answer'), answer);
  assert.equal(reader.get('text').value, '\ufeffZażółć\0😃');
  assert.equal(reader.get('').value, null);
  assert.equal(reader.get('absent'), null);
  assert.equal(reader.get('Answer'), null);
  assert.equal(reader.getRawData('absent'), null);
  for (const name of ['bytes', 'stream', 'opaque']) {
    const first = reader.get(name);
    const expected = [...first.value];
    first.value.fill(0);
    assert.deepEqual([...reader.get(name).value], expected);
  }
  assert.equal(reader.get('opaque').diagnostic.code, LoadErrorCode.UnsupportedFeature);
  assert.equal(reader.get('opaque').typeName, 'Fixture.Serialized, Fixture');
  const raw = reader.getRawData('answer');
  assert.deepEqual([...raw.data], [42, 0, 0, 0]);
  raw.data.fill(0);
  assert.equal(reader.get('answer').value, 42);
  assert.deepEqual([...reader.entries()].map(([name]) => name), reader.names);
});

test('resource name hash collisions, shared data offsets, empty files and subarray inputs remain unambiguous', () => {
  const collision = resourceImage([
    { name: ' a', type: 8, data: new Writer().u32(1).finish() },
    { name: '!@', type: 8, data: new Writer().u32(2).finish() },
    { name: 'alias', alias: 0 },
  ]);
  assert.equal(collision.records[0].hash, collision.records[1].hash);
  const padded = new Uint8Array(collision.bytes.length + 24);
  padded.set(collision.bytes, 16);
  const reader = new ManagedResourceReader(padded.subarray(16, 16 + collision.bytes.length));
  assert.equal(reader.get(' a').value, 1);
  assert.equal(reader.get('!@').value, 2);
  assert.equal(reader.get('alias'), reader.get(' a'));
  const empty = new ManagedResourceReader(resourceImage([]).bytes.buffer);
  assert.deepEqual(empty.names, []);
  assert.deepEqual([...empty.entries()], []);
  assert.equal(empty.count, 0);
});

test('resource lifetime and cancellation apply to warmed caches and active iterators', () => {
  const bytes = primitiveResourceImage().bytes;
  assert.throws(() => new ManagedResourceReader(bytes, { signal: AbortSignal.abort() }), error => error.code === LoadErrorCode.Cancelled);
  const reader = new ManagedResourceReader(bytes);
  reader.get('answer');
  assert.throws(() => reader.get('answer', { signal: AbortSignal.abort() }), error => error.code === LoadErrorCode.Cancelled);
  const controller = new AbortController();
  const cancelled = reader.entries({ signal: controller.signal });
  cancelled.next();
  controller.abort();
  assert.throws(() => cancelled.next(), error => error.code === LoadErrorCode.Cancelled);
  const iterator = reader.entries();
  iterator.next();
  const snapshot = reader.get('bytes');
  reader.dispose();
  reader.dispose();
  assert.equal(reader.isDisposed, true);
  assert.deepEqual([...snapshot.value], [1, 2, 3]);
  for (const operation of [() => reader.get('answer'), () => reader.names, () => reader.count, () => reader.header,
    () => reader.getRawData('bytes'), () => iterator.next()]) {
    assert.throws(operation, error => error.code === LoadErrorCode.Disposed);
  }
});

test('resource byte, entry, type, name, metadata and value budgets reject before unbounded materialization', () => {
  const fixture = primitiveResourceImage();
  for (const options of [{ maxBytes: fixture.bytes.length - 1 }, { maxEntries: 5 }, { maxTypes: 0 },
    { maxNameBytes: 2 }, { maxMetadataBytes: fixture.metadataBytes - 1 }, { maxHeaderBytes: fixture.headerBytes - 1 }]) {
    assert.throws(() => new ManagedResourceReader(fixture.bytes, options), error => error.code === LoadErrorCode.LimitExceeded);
  }
  assert.equal(new ManagedResourceReader(fixture.bytes, { maxMetadataBytes: fixture.metadataBytes }).count, 6);
  const values = new ManagedResourceReader(fixture.bytes, { maxValueBytes: 3 });
  assert.throws(() => values.get('answer'), error => error.code === LoadErrorCode.LimitExceeded);
  const strings = new ManagedResourceReader(fixture.bytes, { maxStringBytes: 3 });
  assert.throws(() => strings.get('text'), error => error.code === LoadErrorCode.LimitExceeded);
  assert.equal(new ManagedResourceReader(fixture.bytes, { maxValueBytes: 4 }).get('answer').value, 42);
  for (const maxEntries of [-1, 1.5, NaN, 1000001]) {
    assert.throws(() => new ManagedResourceReader(fixture.bytes, { maxEntries }), error => error.code === LoadErrorCode.InvalidConfiguration);
  }
  class MisleadingBytes extends Uint8Array {
    get byteLength() { return 0; }
    get length() { return 0; }
  }
  assert.throws(() => new ManagedResourceReader(new MisleadingBytes(fixture.bytes), { maxBytes: 1 }),
    error => error.code === LoadErrorCode.LimitExceeded);
  const detached = new ArrayBuffer(8);
  structuredClone(detached, { transfer: [detached] });
  assert.throws(() => new ManagedResourceReader(detached), error => error.code === LoadErrorCode.InvalidImage);
});

test('64-bit integers, decimal sign/scale and DateTime binary forms are represented without precision or timezone loss', () => {
  const reader = new ManagedResourceReader(resourceImage([
    { name: 'long', type: 10, data: new Writer().i64(-9223372036854775808n).finish() },
    { name: 'ulong', type: 11, data: new Writer().i64(-1n).finish() },
    { name: 'decimal', type: 14, data: new Writer().u32(12300).u32(0).u32(0).u32(0x80040000).finish() },
    { name: 'date', type: 15, data: new Writer().i64(0x48dc000000000000n).finish() },
    { name: 'local', type: 15, data: new Writer().i64(BigInt.asIntN(64, 0x88dc000000000000n)).finish() },
    { name: 'span', type: 16, data: new Writer().i64(-1234567890123456n).finish() },
  ]).bytes);
  assert.equal(reader.get('long').value, -9223372036854775808n);
  assert.equal(reader.get('ulong').value, 18446744073709551615n);
  assert.deepEqual(reader.get('decimal').value, { coefficient: 12300n, scale: 4, negative: true });
  assert.deepEqual(reader.get('date').value, { binary: 0x48dc000000000000n, kindBits: 1 });
  assert.deepEqual(reader.get('local').value, { binary: BigInt.asIntN(64, 0x88dc000000000000n), kindBits: 2 });
  assert.deepEqual(reader.get('span').value, { ticks: -1234567890123456n });
  assert.ok(Object.isFrozen(reader.get('decimal').value));
});

test('future ResourceManager headers remain skippable while unsupported data formats and reader types are explicit', () => {
  assert.equal(new ManagedResourceReader(resourceImage([], { managerVersion: 2 }).bytes).header.readerType, null);
  for (const options of [{ version: 1 }, { version: 3 }, { readerType: 'Custom.ResourceReader, Custom' }]) {
    assert.throws(() => new ManagedResourceReader(resourceImage([], options).bytes), error => {
      assert.equal(error.code, LoadErrorCode.UnsupportedFeature);
      assert.equal(error.managedType, 'System.NotSupportedException');
      return true;
    });
  }
  const extensions = new ManagedResourceReader(resourceImage([{ name: 'text', type: 1, data: resourceString('value') }], {
    readerType: 'System.Resources.Extensions.DeserializingResourceReader, System.Resources.Extensions',
  }).bytes);
  assert.equal(extensions.get('text').value, 'value');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Writer } from '@sharpforge/cil';
import { ManagedResourceReader, LoadErrorCode } from '../packages/clr/src/index.js';
import { primitiveResourceImage, resourceImage } from './clr-resources-fixtures.js';

function changed(fixture, offset, value) {
  const bytes = new Uint8Array(fixture.bytes);
  new DataView(bytes.buffer).setUint32(offset, value, true);
  return bytes;
}

function readFully(bytes, options) {
  const reader = new ManagedResourceReader(bytes, options);
  try { return [...reader.entries()]; }
  finally { reader.dispose(); }
}

const badImage = error => error.code === LoadErrorCode.InvalidImage;

test('resource header, count and section offsets reject truncated and corrupt data', () => {
  const fixture = primitiveResourceImage();
  for (const end of [0, 3, 8, fixture.formatOffset - 1, fixture.dataOffsetField + 3]) {
    assert.throws(() => readFully(fixture.bytes.slice(0, end)), badImage);
  }
  const scalar = resourceImage([{ name: 'value', type: 8, data: new Writer().u32(42).finish() }]).bytes;
  assert.throws(() => readFully(scalar.slice(0, -1)), badImage);
  const corruptions = [
    [0, 0], [4, 0xffffffff], [8, 0xffffffff], [fixture.formatOffset + 4, 0xffffffff],
    [fixture.formatOffset + 8, 0xffffffff], [fixture.dataOffsetField, fixture.namesStart - 1],
    [fixture.dataOffsetField, fixture.bytes.length + 1], [fixture.positionsStart, 0xffffffff],
    [fixture.positionsStart, fixture.dataStart - fixture.namesStart],
    [fixture.records[0].dataField, 0xffffffff], [fixture.records[0].dataField, fixture.bytes.length - fixture.dataStart],
  ];
  for (const [offset, value] of corruptions) assert.throws(() => readFully(changed(fixture, offset, value)), badImage);
  assert.throws(() => readFully(changed(fixture, fixture.formatOffset + 4, 100001)),
    error => error.code === LoadErrorCode.LimitExceeded);
  assert.throws(() => readFully(changed(fixture, 8, 0), { maxHeaderBytes: fixture.headerBytes - 1 }),
    error => error.code === LoadErrorCode.LimitExceeded);
  for (const input of [null, undefined, [1, 2], 'data', new DataView(new ArrayBuffer(32))]) {
    assert.throws(() => new ManagedResourceReader(input), badImage);
  }
});

test('resource name tables require sorted matching hashes, unique names and bounded valid UTF-16', () => {
  const fixture = primitiveResourceImage();
  const firstHash = new DataView(fixture.bytes.buffer).getInt32(fixture.hashStart, true);
  assert.throws(() => readFully(changed(fixture, fixture.hashStart, firstHash ^ 1)), badImage);
  assert.throws(() => readFully(changed(fixture, fixture.hashStart, 0x7fffffff)), /hashes are not sorted/);
  assert.throws(() => readFully(resourceImage([{ name: 'same', type: 0 }, { name: 'same', type: 0 }]).bytes), /Duplicate resource name/);
  const one = resourceImage([{ name: 'name', type: 0 }]);
  const odd = new Uint8Array(one.bytes);
  odd[one.namesStart] = 7;
  assert.throws(() => readFully(odd), /odd UTF-16 byte length/);
  const surrogate = new Uint8Array(one.bytes);
  new DataView(surrogate.buffer).setUint16(one.namesStart + 1, 0xd800, true);
  assert.throws(() => readFully(surrogate), badImage);
  const outside = new Uint8Array(one.bytes);
  outside[one.namesStart] = 100;
  assert.throws(() => readFully(outside), badImage);
});

test('resource values cannot read into adjacent records or cache failed decodings', () => {
  const fixture = resourceImage([
    { name: 'bad', type: 32, data: new Writer().u32(8).finish() },
    { name: 'good', type: 8, data: new Writer().u32(42).finish() },
  ]);
  const reader = new ManagedResourceReader(fixture.bytes);
  for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => reader.get('bad'), badImage);
  assert.equal(reader.get('good').value, 42);
  const negative = changed(fixture, fixture.records[0].dataPosition + 1, 0xffffffff);
  assert.throws(() => readFully(negative), /Negative resource byte payload/);
  const excessive = changed(fixture, fixture.records[0].dataPosition + 1, 0x7fffffff);
  assert.throws(() => readFully(excessive), error => error.code === LoadErrorCode.LimitExceeded);
});

test('reserved codes, invalid user indices, malformed varints, UTF-8 and Decimal/DateTime payloads produce managed diagnostics', () => {
  const cases = [
    { type: 17 },
    { type: 64 },
    { type: 1, data: Uint8Array.of(2, 0xc0, 0xaf) },
    { type: 1, data: Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x0f) },
    { type: 14, data: new Writer().u32(0).u32(0).u32(0).u32(1).finish() },
    { type: 14, data: new Writer().u32(0).u32(0).u32(0).u32(29 << 16).finish() },
    { type: 15, data: new Writer().i64(3155378976000000000n | 0x4000000000000000n).finish() },
  ];
  for (const value of cases) assert.throws(() => readFully(resourceImage([{ name: 'bad', ...value }]).bytes), badImage);
  const integer = resourceImage([{ name: 'bad', type: 0, data: new Uint8Array(4) }]);
  integer.bytes.set([0x80, 0x80, 0x80, 0x80, 0x08], integer.dataStart);
  assert.throws(() => readFully(integer.bytes), /Invalid resource 7-bit integer/);
  const hugeString = resourceImage([{ name: 'bad', type: 1, data: Uint8Array.of(0xff, 0xff, 0xff, 0x7f) }]);
  assert.throws(() => readFully(hugeString.bytes), error => error.code === LoadErrorCode.LimitExceeded);
});

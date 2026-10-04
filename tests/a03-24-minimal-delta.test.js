import test from 'node:test';
import assert from 'node:assert/strict';
import { Writer, readMetadata, metadataSchemas, MetadataBuilder } from '@sharpforge/cil';

// SRM MetadataSizes.cs blob 5a7d6ce08f3aa6a87e5e1c7f1a7f0241c0b67b34:
// IsEncDelta emits #-/#JTD; references are wide and scalar UInt16 columns stay narrow.
function fixture({ tableName = '#-', marker = new Uint8Array(), truncate = 0, heapFlags = 7 } = {}) {
  const rows = {
    31: [[0x3100002a]],
    48: [[0x10001, 0x10002, 0x10003, 0x10004]],
    49: [[1, 0x10005]],
    50: [[1, 1, 1, 1, 0x10006, 0x10007]],
    51: [[0xabcd, 0x1234, 0x10008]],
    53: [[0, 0x10009]],
    55: [[0x10020, 0x1000a, 0x1000b]],
  };
  let mask = 0n;
  for (const table of Object.keys(rows)) mask |= 1n << BigInt(table);
  const tables = new Writer().u32(0).u8(2).u8(0).u8(heapFlags).u8(1)
    .u32(Number(mask & 0xffffffffn)).u32(Number(mask >> 32n)).u32(0).u32(0);
  for (const values of Object.values(rows)) tables.u32(values.length);
  for (const [table, values] of Object.entries(rows)) {
    for (const row of values) {
      row.forEach((value, column) => {
        if (metadataSchemas[table][column] === 'u16') tables.u16(value);
        else tables.u32(value);
      });
    }
  }
  const payload = tables.finish();
  const streams = [[tableName, payload.subarray(0, payload.length - truncate)]];
  if (marker !== null) streams.push(['#JTD', marker]);
  const root = new Writer().u32(0x424a5342).u16(1).u16(1).u32(0).u32(4)
    .bytes(new Uint8Array([118, 49, 0, 0])).u16(0).u16(streams.length);
  const offsets = [];
  for (const [name, bytes] of streams) {
    offsets.push(root.length);
    root.u32(0).u32(bytes.length).bytes(new TextEncoder().encode(name)).u8(0).pad();
  }
  streams.forEach(([, bytes], index) => {
    root.pad();
    root.patch32(offsets[index], root.length);
    root.bytes(bytes);
  });
  return { bytes: root.finish(), rows };
}

test('A03 #JTD forces wide table, heap and coded references while preserving UInt16 scalars', () => {
  for (const heapFlags of [0, 7]) {
    const { bytes, rows } = fixture({ heapFlags });
    const metadata = readMetadata(bytes);
    assert.deepEqual(metadata.rows, rows);
    assert.equal(metadata.minimalDelta, true);
    assert.equal(metadata.uncompressed, true);
  }
});

test('A03 #JTD rejects compressed tables, nonempty markers and truncated wide rows', () => {
  for (const options of [{ tableName: '#~' }, { marker: new Uint8Array([0]) }]) {
    assert.throws(() => readMetadata(fixture(options).bytes), /Invalid minimal metadata delta marker/);
  }
  assert.throws(() => readMetadata(fixture({ truncate: 1 }).bytes), /Truncated metadata table payload/);
});

test('A03 ordinary compressed and uncompressed metadata keep their existing reference widths', () => {
  for (const uncompressed of [false, true]) {
    const builder = new MetadataBuilder('Baseline', { uncompressed });
    builder.add(4, [0x1234, builder.string('field'), builder.blob(new Uint8Array([6, 8]))]);
    const metadata = readMetadata(builder.finish());
    assert.equal(metadata.minimalDelta, false);
    assert.equal(metadata.uncompressed, uncompressed);
    assert.equal(metadata.rows[4][0][0], 0x1234);
    assert.equal(metadata.string(metadata.rows[4][0][1]), 'field');
  }
});

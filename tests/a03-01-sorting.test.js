import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, readMetadata, codedIndex, decodeCoded, metadataSortedMask } from '@sharpforge/cil';

const cases = [[9, 0], [11, 1], [12, 0], [13, 0], [14, 1], [15, 2], [16, 1], [24, 2],
  [25, 0], [28, 1], [29, 1], [41, 0], [42, 2], [44, 0]];
test('A03 required tables sort without changing insertion handles', () => {
  const builder = new MetadataBuilder('Sort');
  const lengths = { 9: 2, 11: 3, 12: 3, 13: 2, 14: 3, 15: 3, 16: 2, 24: 3, 25: 3, 28: 4, 29: 2, 41: 2, 42: 4, 44: 2 };
  for (const [table, column] of cases) {
    for (const key of [3, 2, 1]) {
      const row = Array(lengths[table]).fill(0);
      row[column] = key;
      builder.add(table, row);
    }
  }
  const bytes = builder.finish();
  const metadata = readMetadata(bytes);
  assert.equal(metadata.sortedMask, metadataSortedMask);
  assert.equal(metadata.sortedMask, 0x16003301fa00n);
  for (const [table, column] of cases) {
    assert.deepEqual(metadata.rows[table].map(row => row[column]), [1, 2, 3]);
    assert.deepEqual(builder.rows[table].map(row => row[column]), [3, 2, 1]);
  }
  assert.deepEqual(builder.finish(), bytes);
});

test('A03 sorting remaps generic constraints and custom attribute parent handles', () => {
  const builder = new MetadataBuilder('Handles');
  const second = builder.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x02000002), 0]);
  const first = builder.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x02000001), 0]);
  const constraint = builder.add(44, [second & 0xffffff, 5]);
  builder.add(44, [first & 0xffffff, 5]);
  builder.add(12, [codedIndex('HasCustomAttribute', constraint), 10, 0]);
  builder.add(12, [codedIndex('HasCustomAttribute', second), 10, 0]);
  const metadata = readMetadata(builder.finish());
  assert.deepEqual(metadata.rows[44], [[1, 5], [2, 5]]);
  const parents = metadata.rows[12].map(row => decodeCoded('HasCustomAttribute', row[0]));
  assert(parents.includes(0x2a000002));
  assert(parents.includes(0x2c000002));
  assert.equal(builder.tokenMap.get(second), 0x2a000002);
});

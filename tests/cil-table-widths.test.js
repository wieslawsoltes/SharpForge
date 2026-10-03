import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, readMetadata, metadataSchemas, metadataCodedIndices, metadataIndexWidth } from '@sharpforge/cil';

function boundaryImage(kind, count) {
  const builder = new MetadataBuilder('Widths');
  builder.rows = {};
  const coded = metadataCodedIndices[kind];
  const target = coded ? coded[1].find(table => table !== null) : Number(kind.slice(1));
  const source = Object.entries(metadataSchemas).find(([, columns]) => columns.includes(kind));
  assert(source, kind);
  const table = Number(source[0]);
  const column = source[1].indexOf(kind);
  const value = coded ? count * 2 ** coded[0] + coded[1].indexOf(target) : count;
  builder.rows[target] = Array.from({ length: count }, () => metadataSchemas[target].map(() => 0));
  if (table !== target) builder.rows[table] = [source[1].map(() => 0)];
  builder.rows[table][0][column] = value;
  return { builder, table, column, value, target };
}

test('A03 all coded indexes change width exactly at their tag-bit boundary and round-trip', () => {
  for (const [kind, [bits]] of Object.entries(metadataCodedIndices)) {
    const boundary = 2 ** (16 - bits);
    for (const count of [boundary - 1, boundary]) {
      const { builder, table, column, value, target } = boundaryImage(kind, count);
      assert.equal(metadataIndexWidth(kind, { [target]: count }, 0), count < boundary ? 2 : 4, kind);
      const metadata = readMetadata(builder.finish());
      assert(metadata.rows[table].some(row => row[column] === value), `${kind} ${count}`);
      assert.equal(metadata.counts[target], count);
    }
  }
});

test('A03 all simple indexes round-trip the 65535 and 65536 boundaries', () => {
  const kinds = new Set(Object.values(metadataSchemas).flat().filter(kind => /^t\d+$/.test(kind)));
  for (const kind of kinds) {
    for (const count of [65535, 65536]) {
      const { builder, table, column, value, target } = boundaryImage(kind, count);
      assert.equal(metadataIndexWidth(kind, { [target]: count }, 0), count === 65535 ? 2 : 4, kind);
      const metadata = readMetadata(builder.finish());
      assert(metadata.rows[table].some(row => row[column] === value), `${kind} ${count}`);
      assert.equal(metadata.counts[target], count);
    }
  }
});

test('A03 table reader prechecks declared bytes and writer rejects truncating values', () => {
  const builder = new MetadataBuilder('Truncated');
  const bytes = builder.finish();
  const metadata = readMetadata(bytes);
  new DataView(bytes.buffer).setUint32(metadata.tableOffset + 24, 900000, true);
  assert.throws(() => readMetadata(bytes), /Truncated metadata table payload/);
  builder.add(4, [65536, 0, 0]);
  assert.throws(() => builder.finish(), /exceeds its 2-byte range/);
  const empty = new MetadataBuilder('Empty');
  empty.rows[4] = [];
  assert.equal(readMetadata(empty.finish()).counts[4], 0);
});

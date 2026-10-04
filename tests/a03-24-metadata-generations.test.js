import assert from 'node:assert/strict';
import test from 'node:test';
import { CilError, MetadataGenerations, metadataGenerationDiagnosticCatalog, readMetadata } from '@sharpforge/cil';
import { cliGenerationFixture, editCliDelta } from './support/cli-metadata-delta.js';

function history(fixture = cliGenerationFixture()) {
  const reader = new MetadataGenerations(fixture.baseline);
  fixture.deltas.forEach((delta, index) => reader.append(delta.bytes, { generation: index + 1 }));
  return reader;
}

test('CLI history separates original definitions, local rows and latest updates', () => {
  const fixture = cliGenerationFixture(), reader = history(fixture);
  assert.equal(reader.generation, 2);
  assert.equal(reader.counts[6], 3);
  assert.equal(reader.counts[17], 2);
  assert.equal(reader.counts[26], 2);
  assert.deepEqual(reader.getGenerationHandle({ kind: 'entity', value: 0x06000002 }),
    { kind: 'entity', value: 0x06000002, generation: 1, localValue: 0x06000002 });
  assert.equal(reader.row(0x06000002).generation, 2);
  assert.equal(reader.row(0x06000002).localToken, 0x06000001);
  assert.equal(reader.row(0x06000001).generation, 1);
  assert.equal(reader.row(0x06000001, { generation: 0 }).generation, 0);
  assert.equal(reader.getAggregateToken(0x06000001, 2), 0x06000002);
  assert.equal(reader.getAggregateToken(0x06000002, 2), 0x06000003);
  assert.equal(reader.getAggregateToken(1, 2), 1);
  assert.equal(reader.row(1).generation, 2);
  assert.equal(reader.getGenerationHandle({ kind: 'entity', value: 1 }).generation, 0);
  assert.equal(reader.row(0x06000002).values[5], 0, 'raw delta ParamList is retained');
  assert.equal(reader.row(0x06000001, { generation: 0 }).values[5], 1);
  const page = reader.rows('MethodDef', { offset: 1, limit: 1 });
  assert.equal(page.rows[0].token, 0x06000002);
  assert.equal(page.nextOffset, 2);
  assert.equal(reader.rows(6, { offset: 3 }).rows.length, 0);
  assert.equal(reader.rows(6, { limit: 0 }).nextOffset, null);
  assert.equal(reader.controlRows('EncMap', { generation: 1 }).rows.length, 4);
  assert.equal(reader.controlRows('EncMap', { generation: 1 }).rows[0].token, null);
  assert.equal(reader.controlRows(30, { generation: 1 }).rows[0].values[1], 1);
});

test('CLI generation heap values span generations without retaining caller-visible backing buffers', () => {
  const fixture = cliGenerationFixture(), reader = history(fixture);
  assert.equal(reader.heapEntry('#US', fixture.userString).value, 'baseline');
  assert.equal(reader.heapEntry('#US', fixture.deltas[0].userString).value, 'first delta λ');
  assert.equal(reader.heapEntry('#US', fixture.deltas[1].userString).value, 'second delta 😀');
  const method = reader.row(0x06000002), signature = method.values[4];
  assert.equal(reader.heapEntry('#Strings', method.values[3]).value, 'Added');
  assert.deepEqual(reader.heapEntry('#Blob', signature).value, Uint8Array.from([0, 0, 1]));
  const blob = reader.heapEntry('#Blob', signature);
  blob.value.fill(255);
  assert.deepEqual(reader.heapEntry('#Blob', signature).value, Uint8Array.from([0, 0, 1]));
  const guid = reader.heapEntry('#GUID', 1);
  guid.value.fill(0);
  assert.deepEqual(reader.heapEntry('#GUID', 1).value, fixture.metadata.guid(1));
  assert.deepEqual(reader.getGenerationHandle({ kind: 'guid', value: 4 }),
    { kind: 'guid', value: 4, generation: 1, localValue: 4 });
  assert.throws(() => reader.heapEntry('#GUID', 4), { code: 'MD_GEN_HEAP' });
  assert.equal(reader.heapEntry('#Strings', 0).isNil, true);
  assert.equal(reader.heapEntry('#US', 0).value, null);
  assert.equal(reader.heapEntry('#GUID', 0).value.length, 16);
});

test('CLI reader owns inputs, projections and historical results across append and disposal', () => {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  const old = reader.row(0x06000001), original = [...old.values];
  fixture.baseline.fill(0);
  reader.append(fixture.deltas[0].bytes, { generation: 1 });
  fixture.deltas[0].bytes.fill(0);
  assert.deepEqual(old.values, original);
  old.values.fill(0);
  assert.notDeepEqual(reader.row(0x06000001, { generation: 0 }).values, old.values);
  const counts = reader.counts, identity = reader.identity, tables = reader.tables();
  counts[6] = 0;
  identity.mvid = 'changed';
  tables[0].columns.fill('changed');
  assert.equal(reader.counts[6], 2);
  assert.notEqual(reader.identity.mvid, 'changed');
  assert.notEqual(reader.tables()[0].columns[0], 'changed');
  const preserved = reader.row(0x06000002);
  reader.dispose();
  reader.dispose();
  assert.equal(preserved.token, 0x06000002);
  for (const read of [() => reader.generation, () => reader.counts, () => reader.identity, () => reader.retainedBytes,
    () => reader.row(1), () => reader.rows(6), () => reader.heaps(), () => reader.append(fixture.deltas[1].bytes, { generation: 2 })]) {
    assert.throws(read, { code: 'MD_GEN_DISPOSED' });
  }
});

test('CLI delta supports the optional explicit Module EncMap entry', () => {
  const fixture = cliGenerationFixture(), reader = new MetadataGenerations(fixture.baseline);
  const bytes = editCliDelta(fixture.deltas[0].bytes, rows => rows[31].unshift([1]));
  reader.append(bytes, { generation: 1 });
  assert.equal(reader.row(1).generation, 1);
  assert.equal(reader.getAggregateToken(1, 1), 1);
});

test('compressed and ordinary uncompressed baselines share the same generation contract', () => {
  for (const uncompressed of [false, true]) {
    const fixture = cliGenerationFixture({ uncompressed });
    assert.equal(readMetadata(fixture.baseline).uncompressed, uncompressed);
    assert.equal(history(fixture).row(0x06000003).generation, 2);
  }
  assert.equal(typeof metadataGenerationDiagnosticCatalog.MD_GEN_MAP, 'string');
  assert.throws(() => new MetadataGenerations(new Uint8Array([0])), CilError);
});

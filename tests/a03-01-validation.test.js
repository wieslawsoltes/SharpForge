import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataBuilder, readMetadata, readPE, validateMetadata, metadataDiagnosticCatalog } from '@sharpforge/cil';
import { metadataFixture, metadataImage } from './fixtures/a03-metadata/fixture.js';
import { metadataDefects } from './fixtures/a03-metadata/defects.js';

test('A03 forty single-defect serialized images report exactly their expected diagnostic', () => {
  assert.equal(metadataDefects.length, 40);
  assert.deepEqual(validateMetadata(readPE(metadataImage(metadataFixture().builder), { inspection: true }).metadata), []);
  for (const [name, expected, mutate] of metadataDefects) {
    const { builder } = metadataFixture();
    mutate(builder);
    const metadata = readPE(metadataImage(builder), { inspection: true }).metadata;
    assert.deepEqual(validateMetadata(metadata).map(diagnostic => diagnostic.code), [expected], name);
    assert.equal(typeof metadataDiagnosticCatalog[expected], 'string');
  }
});

test('A03 Roslyn-built metadata fixtures pass structural validation', () => {
  for (const name of ['VersionedLib.1.0.0.0.dll', 'ConsumerOfV1.dll', 'Facade.dll', 'MiniStandard.dll']) {
    const bytes = readFileSync(new URL(`./fixtures/metadata/${name}`, import.meta.url));
    assert.deepEqual(validateMetadata(readPE(bytes, { inspection: true }).metadata), [], name);
  }
  const pdb = readFileSync(new URL('./fixtures/portable-pdb/Documents.pdb', import.meta.url));
  assert.deepEqual(validateMetadata(readMetadata(pdb)), []);
});

test('A03 validator bounds diagnostics, honors cancellation and validates pointer streams', () => {
  const { builder } = metadataFixture();
  builder.rows[4][0][1] = 0;
  builder.rows[4][0][2] = 0;
  const metadata = readMetadata(builder.finish());
  assert.deepEqual(validateMetadata(metadata, { maxDiagnostics: 1 }).map(diagnostic => diagnostic.code), ['MD0005', 'MD0099']);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => validateMetadata(metadata, { signal: controller.signal }), { code: 'MD_CANCELED' });
  assert.throws(() => validateMetadata(metadata, { maxDiagnostics: 0 }), /diagnostic limit/);
  const pointers = new MetadataBuilder('Pointers');
  pointers.add(2, [0, pointers.string('<Module>'), 0, 0, 1, 1]);
  pointers.add(3, [1]);
  pointers.add(4, [6, pointers.string('Field'), pointers.blob(new Uint8Array([6, 8]))]);
  assert.deepEqual(validateMetadata(readMetadata(pointers.finish())).map(diagnostic => diagnostic.code), ['MD0017']);
});

test('A03 validator observes physical sorted order and pointer permutation boundaries', () => {
  const { builder } = metadataFixture();
  builder.add(9, [3, 16]);
  const metadata = readMetadata(builder.finish());
  metadata.rows[9].reverse();
  assert.deepEqual(validateMetadata(metadata).map(diagnostic => diagnostic.code), ['MD0016']);
  const pointers = new MetadataBuilder('EmptyPointers', { uncompressed: true });
  pointers.add(2, [0, pointers.string('<Module>'), 0, 0, 1, 1]);
  pointers.rows[3] = [];
  pointers.add(4, [6, pointers.string('Field'), pointers.blob(new Uint8Array([6, 8]))]);
  assert.deepEqual(validateMetadata(readMetadata(pointers.finish())).map(diagnostic => diagnostic.code), ['MD0018']);
});

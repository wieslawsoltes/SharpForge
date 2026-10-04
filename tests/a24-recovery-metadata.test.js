import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateWorkspaceRecovery, encodeRecoveryRecord, decodeRecoveryRecord, OpfsRecoveryStore} from '@sharpforge/workspace';
import {memoryDirectory} from './support/memory-directory-handle.js';

const loaded = {path: 'A.cs', text: 'class A {}', version: 41};
const lazy = {path: 'cafe\u0301/B.cs', lazy: true, size: 70, lastModified: 123, compile: true};

test('historical versions retain explicit lazy membership and overlay newer editor text without fabricating bytes', async () => {
  for (let minor = 6; minor <= 14; minor++) {
    const input = {version: `0.${minor}.0`, diskRecords: [{...loaded, text: 'old'}, lazy],
      files: [{uri: 'A.cs', text: 'newest', version: 42}], tabs: ['A.cs', lazy.path], active: 'A.cs',
      configuration: 'Release', langVersion: '13', entry: undefined, dirty: ['A.cs']};
    const record = migrateWorkspaceRecovery(input);
    assert.equal(record.records[0].text, 'newest');
    assert.equal(record.records[0].version, 42);
    assert.deepEqual(record.records[1], lazy);
    assert.deepEqual(record.dirty, ['A.cs']);
    assert.equal(record.settings.configuration, 'Release');
    const restored = await decodeRecoveryRecord(await encodeRecoveryRecord(record));
    assert.deepEqual(restored.records[1], lazy);
    assert.equal(restored.records[1].text, undefined);
    assert.equal(restored.records[1].bytes, undefined);
  }
});

test('lazy metadata is bounded and malformed, aliased or cancelled records never become empty source', () => {
  assert.equal(migrateWorkspaceRecovery({records: Array.from({length: 20000}, (_, index) =>
    ({path: 'C' + index + '.cs', lazy: true, size: 0}))}).records.length, 20000);
  for (const value of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => migrateWorkspaceRecovery({records: [{...lazy, size: value}]}), /Invalid size/);
  }
  assert.throws(() => migrateWorkspaceRecovery({records: [{path: 'Missing.cs'}]}), /Missing recovery contents/);
  assert.throws(() => migrateWorkspaceRecovery({records: [lazy, {...lazy, path: 'CAFÉ/B.cs'}]}), /Duplicate recovery path/);
  assert.throws(() => migrateWorkspaceRecovery({records: [lazy]}, {maxFiles: 0}), /file limit/);
  assert.throws(() => migrateWorkspaceRecovery({records: [lazy]}, {maxBytes: 1}), /byte limit/);
  assert.throws(() => migrateWorkspaceRecovery({records: [lazy]}, {signal: AbortSignal.abort()}), {name: 'AbortError'});
});

test('OPFS quota fallback preserves lazy membership and enumerates only omitted loaded binary contents', async () => {
  const store = new OpfsRecoveryStore({directory: memoryDirectory(), storage: {estimate: async () => ({quota: 10000})}});
  const result = await store.save({records: [loaded, lazy, {path: 'asset.bin', bytes: new Uint8Array(25000).fill(255)}]});
  assert.equal(result.degraded, true);
  assert.deepEqual(result.omittedBinaryFiles, ['asset.bin']);
  const recovered = (await store.load()).record;
  assert.equal(recovered.records.length, 3);
  assert.deepEqual(recovered.records[1], lazy);
  assert.deepEqual(recovered.records[2], {path: 'asset.bin', recoveryMissing: 'quota', size: 25000, lazy: true});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateWorkspaceRecovery, encodeRecoveryRecord, decodeRecoveryRecord, inspectRecoveryRecord, OpfsRecoveryStore}
  from '@sharpforge/workspace';
import {memoryDirectory, setHandleText} from './support/memory-directory-handle.js';

function recovery(version = '0.14.0') {
  return {version, name: 'Recovery test', files: [
    {path: 'A.cs', text: 'class A {}', version: 9},
    {path: 'assets/data.bin', bytes: Uint8Array.of(0, 255, 128, 10)},
    {path: 'notes/cafe\u0301.txt', text: 'preserve NFD spelling'},
  ], folders: ['Empty'], tabs: ['A.cs'], active: 'A.cs',
  settings: {theme: 'dark', trusted: true, nested: {hostToken: 'secret-sentinel', label: 'safe'}},
  credentials: {password: 'secret-sentinel'}};
}

test('every historical recovery version migrates bytes, document versions and Unicode spelling without authority', async () => {
  for (let minor = 6; minor <= 14; minor++) {
    const source = recovery(`0.${minor}.0`);
    const original = structuredClone(source);
    const migrated = migrateWorkspaceRecovery(source);
    assert.equal(migrated.schemaVersion, 1);
    assert.equal(migrated.records[0].version, 9);
    assert.equal(migrated.records[2].path, 'notes/cafe\u0301.txt');
    assert.deepEqual(migrated.records[1].bytes, Uint8Array.of(0, 255, 128, 10));
    assert.deepEqual(source, original, 'migration may not mutate its source');
    const encoded = await encodeRecoveryRecord(migrated);
    assert.ok(!encoded.includes('secret-sentinel'));
    assert.equal(migrated.settings.nested.label, 'safe');
    assert.deepEqual((await decodeRecoveryRecord(encoded)).records[1].bytes, source.files[1].bytes);
  }
});

test('corrupt checkpoints are quarantined while newer schemas are preserved intact', async () => {
  const encoded = await encodeRecoveryRecord(recovery());
  const corrupted = encoded.replace('class A {}', 'class B {}');
  const quarantined = [];
  const result = await inspectRecoveryRecord(corrupted, {quarantine: value => quarantined.push(value)});
  assert.equal(result.record, null);
  assert.equal(result.quarantined, true);
  assert.equal(quarantined[0].text, corrupted);
  const newer = JSON.stringify({format: 'sharpforge-recovery-envelope', version: 3, checksum: 'future', payload: {}});
  const preserved = await inspectRecoveryRecord(newer, {quarantine: value => quarantined.push(value)});
  assert.equal(preserved.preserved, true);
  assert.equal(quarantined.length, 1);
  assert.throws(() => migrateWorkspaceRecovery({schemaVersion: 2, files: []}), /newer/i);
});

test('OPFS checkpoint commit failure retains the last committed generation', async () => {
  let failManifest = false;
  const directory = memoryDirectory({beforeClose(path) {
    if (failManifest && path === 'current.json') throw new Error('injected manifest close failure');
  }});
  const store = new OpfsRecoveryStore({directory});
  await store.save(recovery());
  const second = recovery();
  second.files[0].text = 'class Changed {}';
  failManifest = true;
  await assert.rejects(store.save(second), /manifest close failure/);
  failManifest = false;
  const loaded = await store.load();
  assert.equal(loaded.record.records[0].text, 'class A {}');
  assert.deepEqual(loaded.record.records[1].bytes, recovery().files[1].bytes);
});

test('OPFS load falls back to the prior checksum-verified generation after corruption', async () => {
  const directory = memoryDirectory();
  const store = new OpfsRecoveryStore({directory});
  await store.save(recovery());
  const second = recovery();
  second.files[0].text = 'class Changed {}';
  await store.save(second);
  await setHandleText(directory, 'snapshot-1.json', '{truncated');
  const loaded = await store.load();
  assert.equal(loaded.recoveredPrevious, true);
  assert.equal(loaded.record.records[0].text, 'class A {}');
  assert.ok(loaded.diagnostics.some(diagnostic => diagnostic.code === 'SFW1305'));
});

test('quota exhaustion explicitly lists omitted binaries and preserves text recovery', async () => {
  const value = recovery();
  value.files[1].bytes = new Uint8Array(25000).fill(255);
  const warnings = [];
  const store = new OpfsRecoveryStore({directory: memoryDirectory(),
    storage: {estimate: async () => ({quota: 10000, usage: 0})}, onWarning: warning => warnings.push(warning)});
  const saved = await store.save(value);
  assert.equal(saved.degraded, true);
  assert.deepEqual(saved.omittedBinaryFiles, ['assets/data.bin']);
  const loaded = await store.load();
  assert.equal(loaded.record.records[0].text, 'class A {}');
  assert.deepEqual(loaded.record.omittedBinaryFiles, ['assets/data.bin']);
  assert.equal(warnings.length, 1);
  store.dispose();
  await assert.rejects(store.save(value), /disposed/i);
});

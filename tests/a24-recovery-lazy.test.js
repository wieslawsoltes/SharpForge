import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateWorkspaceRecovery, encodeRecoveryRecord, decodeRecoveryRecord, OpfsRecoveryStore, FileSystemAccessProvider}
  from '@sharpforge/workspace';
import {restoreLegacyWorkspace} from '../apps/studio/workspace-recovery.js';
import {ExplorerPersistence} from '../apps/studio/explorer/persistence.js';
import {memoryDirectory} from './support/memory-directory-handle.js';
import {workspaceApplication} from './support/workspace-application.js';

const loaded = {path: 'A.cs', text: 'class A {}', version: 41};
const lazy = {path: 'cafe\u0301/B.cs', lazy: true, size: 70, lastModified: 123, compile: true};

function localStorage(value, extra = {}) {
  const records = new Map(Object.entries({'sharpforge.workspace.v1': value, ...extra}));
  const writes = [];
  return {writes, get length() { return records.size; }, key: index => [...records.keys()][index],
    getItem: key => records.get(key) ?? null, setItem: (key, value) => { writes.push(key); records.set(key, value); }};
}

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

test('the explorer checkpoints unopened membership and unsaved paths along with loaded bytes', async () => {
  const root = memoryDirectory();
  const data = {identity: 'session', name: 'Recovery', revision: 1, records: [loaded, lazy], folders: ['Empty'],
    active: 'A.cs', tabs: ['A.cs', lazy.path], dirty: ['A.cs']};
  const persistence = new ExplorerPersistence({getData: () => data, environment: {
    crypto: {randomUUID: () => 'window'}, navigator: {storage: {getDirectory: async () => root}}}});
  try {
    persistence.observe(data);
    await persistence.checkpoint(data);
    const recovered = (await persistence.store.load()).record;
    assert.equal(recovered.records.length, 2);
    assert.deepEqual(recovered.records[1], lazy);
    assert.deepEqual(recovered.dirty, ['A.cs']);
    data.dirty = [];
    await persistence.checkpoint(data);
    assert.deepEqual((await persistence.store.load()).record.dirty, []);
  } finally { persistence.dispose(); }
});

test('legacy bootstrap restores loaded editors read-only while preserving unloaded project and manifest records', async () => {
  const app = workspaceApplication();
  const value = {format: 'sharpforge-project', version: 1, name: 'Recovered', configuration: 'Release', langVersion: '13',
    entry: 'App.csproj', startupProject: 'App.csproj', mode: 'project', diskRecords: [loaded, lazy,
      {path: 'App.csproj', size: 100, lazy: true}, {path: '.sharpforge/workspace.json', size: 20, lazy: true}],
    files: [{uri: 'A.cs', text: 'class Unsaved {}', version: 42}], active: 'A.cs', tabs: ['A.cs', lazy.path],
    dirty: ['A.cs'], settings: {token: 'secret-value', nested: {hostToken: 'secret-value'}},
    apps: [{id: 'clock', permission: true, token: 'secret-value'}]};
  const raw = JSON.stringify(value);
  const storage = localStorage(raw, {'sharpforge.explorer.Recovered': JSON.stringify({expanded: ['root']}),
    'sharpforge.templates.recent': JSON.stringify(['console'])});
  const result = await restoreLegacyWorkspace({storage, session: app.session});
  assert.equal(result.restored, true);
  assert.equal(app.state.readOnly, true);
  assert.equal(app.state.recoveryReadOnly, true);
  assert.equal(app.state.files.length, 1);
  assert.equal(app.state.files[0].text, 'class Unsaved {}');
  assert.equal(app.state.files[0].version, 42);
  assert.equal(app.host.context().records.length, 4);
  assert.equal(app.host.context().entry, 'App.csproj');
  assert.equal(app.state.configuration, 'Release');
  assert.equal(app.state.langVersion, '13');
  assert.deepEqual(app.state.tabs, ['A.cs']);
  assert.deepEqual([...app.state.dirtyFiles], ['A.cs']);
  assert.equal(app.events.includes('build'), false);
  assert.equal(app.events.includes('saved-local'), false);
  assert.equal(app.events.includes('previous'), false);
  assert.equal(storage.getItem('sharpforge.workspace.v1'), raw);
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(result.record.recentTemplates, ['console']);
  assert.equal(JSON.stringify(result.record).includes('secret-value'), false);
  assert.equal(JSON.stringify(result.record.appDescriptors).includes('permission'), false);
  assert.equal(app.host.context().appDescriptors[0].id, 'clock');
  assert.deepEqual(app.host.context().recentTemplates, ['console']);
  await assert.rejects(app.session.loadRecord(lazy.path), /Grant folder access/);
  await assert.rejects(app.session.save(), /read-only/);
});

test('corrupt and future legacy snapshots block default replacement and are retained verbatim', async () => {
  for (const raw of ['{truncated', JSON.stringify({schemaVersion: 2, records: [loaded]}),
    JSON.stringify({format: 'future-project', version: 1, files: []})]) {
    const app = workspaceApplication();
    const storage = localStorage(raw);
    const diagnostics = [];
    const result = await restoreLegacyWorkspace({storage, session: app.session, onDiagnostic: value => diagnostics.push(value)});
    assert.equal(result.restored, false);
    assert.equal(result.blocked, true);
    assert.equal(app.state.revision, 1);
    assert.equal(storage.getItem('sharpforge.workspace.v1'), raw);
    assert.deepEqual(storage.writes, []);
    assert.equal(diagnostics.length, 1);
  }
  const absent = await restoreLegacyWorkspace({storage: {getItem: () => null}, session: workspaceApplication().session});
  assert.equal(absent.blocked, false);
  await assert.rejects(restoreLegacyWorkspace({storage: {getItem() { throw new Error('must not read'); }},
    session: workspaceApplication().session, signal: AbortSignal.abort()}), {name: 'AbortError'});
});

test('a granted recent handle restores open-document selection and replaces read-only metadata with real bytes', async () => {
  const app = workspaceApplication();
  await app.session.load([loaded, {path: 'B.cs', size: 10, lazy: true}], {readOnly: true, mode: 'folder'});
  const root = memoryDirectory();
  const provider = new FileSystemAccessProvider(root);
  await provider.writeFile('A.cs', new TextEncoder().encode('class DiskA {}'));
  await provider.writeFile('B.cs', new TextEncoder().encode('class DiskB {}'));
  await app.session.reopenRecent({handle: root, permission: 'granted', readOnly: false, openDocuments: [{path: 'B.cs'}],
    record: {settings: {mode: 'folder', active: 'B.cs', configuration: 'Release'}}});
  assert.equal(app.state.readOnly, false);
  assert.equal(app.state.recoveryReadOnly, false);
  assert.equal(app.state.recoveryEntry, null);
  assert.deepEqual(app.state.tabs, ['B.cs']);
  assert.equal(app.state.active, 'B.cs');
  assert.equal(app.state.files.find(file => file.uri === 'B.cs').text, 'class DiskB {}');
});

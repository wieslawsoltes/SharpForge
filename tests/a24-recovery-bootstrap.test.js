import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreLegacyWorkspace} from '../apps/studio/workspace-recovery.js';

function storageFixture(raw, extra = {}) {
  const values = new Map(Object.entries({'sharpforge.workspace.v1': raw, ...extra}));
  return {get length() { return values.size; }, key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null, setItem() { assert.fail('Recovery must retain original storage'); }};
}

test('legacy bootstrap sends bounded lazy membership and protected editor state to the read-only load boundary', async () => {
  const lazy = {path: 'cafe\u0301/B.cs', size: 100, lazy: true};
  const raw = JSON.stringify({format: 'sharpforge-project', version: 1, name: 'Recovered',
    diskRecords: [{path: 'A.cs', text: 'old', version: 4}, lazy, {path: 'App.csproj', size: 32, lazy: true}],
    files: [{uri: 'A.cs', text: 'newer', version: 5, readOnly: true, generated: true}],
    tabs: ['A.cs', lazy.path], active: 'A.cs', dirty: ['A.cs'], entry: 'App.csproj', startupProject: 'App.csproj',
    configuration: 'Release', settings: {token: 'secret'}, apps: [{id: 'clock', permission: true, hostToken: 'secret'}]});
  const storage = storageFixture(raw, {'sharpforge.templates.recent': '["console"]'});
  let loaded;
  const session = {load: async (records, options) => { loaded = {records, options}; }};
  const result = await restoreLegacyWorkspace({storage, session});
  assert.equal(result.restored, true);
  assert.equal(result.blocked, false);
  assert.deepEqual(loaded.records.map(record => record.path), ['A.cs', lazy.path, 'App.csproj']);
  assert.deepEqual(loaded.records[1], lazy);
  assert.equal(loaded.records[0].text, 'newer');
  assert.equal(loaded.records[0].version, 5);
  assert.equal(loaded.records[0].readOnly, true);
  assert.equal(loaded.records[0].generated, true);
  assert.equal(loaded.options.readOnly, true);
  assert.equal(loaded.options.persist, false);
  assert.equal(loaded.options.entry, 'App.csproj');
  assert.deepEqual(loaded.options.dirty, ['A.cs']);
  assert.equal(loaded.options.settings.configuration, 'Release');
  assert.deepEqual(loaded.options.recoveryMetadata.recentTemplates, ['console']);
  assert.equal(JSON.stringify(loaded).includes('secret'), false);
  assert.equal(JSON.stringify(loaded.options.recoveryMetadata.appDescriptors).includes('permission'), false);
  assert.equal(storage.getItem('sharpforge.workspace.v1'), raw);
});

test('corrupt, future and oversized recovery blocks default replacement while keeping the original record', async () => {
  for (const [raw, options] of [['{truncated', {}], ['{"schemaVersion":2,"records":[]}', {}], ['{}', {maxEncodedBytes: 1}]]) {
    const storage = storageFixture(raw);
    const diagnostics = [];
    const result = await restoreLegacyWorkspace({storage, ...options, session: {load() { assert.fail('Invalid recovery cannot load'); }},
      onDiagnostic: value => diagnostics.push(value)});
    assert.equal(result.restored, false);
    assert.equal(result.blocked, true);
    assert.equal(diagnostics.length, 1);
    assert.equal(storage.getItem('sharpforge.workspace.v1'), raw);
  }
});

test('a rejected host load retains recovery and surfaces a diagnostic without starting fallback work', async () => {
  const raw = '{"files":[{"uri":"A.cs","text":"class A {}"}]}';
  const storage = storageFixture(raw);
  let calls = 0;
  const result = await restoreLegacyWorkspace({storage, session: {async load(records, options) {
    calls++;
    assert.equal(options.readOnly, true);
    throw new Error('SFW1304: Editor budget exceeded');
  }}});
  assert.equal(result.blocked, true);
  assert.equal(result.diagnostics[0].code, 'SFW1304');
  assert.equal(calls, 1);
  assert.equal(storage.getItem('sharpforge.workspace.v1'), raw);
});

test('missing recovery is inert, cancellation propagates, and corrupt optional settings remain visible', async () => {
  const unused = {load() { assert.fail('No load expected'); }};
  assert.deepEqual(await restoreLegacyWorkspace({storage: {getItem: () => null}, session: unused}),
    {restored: false, blocked: false, diagnostics: []});
  await assert.rejects(restoreLegacyWorkspace({storage: {getItem() { assert.fail('Cancelled reads must not start'); }},
    session: unused, signal: AbortSignal.abort()}), {name: 'AbortError'});
  const diagnostics = [];
  const result = await restoreLegacyWorkspace({storage: storageFixture('{"files":[]}', {'sharpforge.explorer.App': '{bad'}),
    session: {load() {}}, onDiagnostic: value => diagnostics.push(value)});
  assert.equal(result.restored, true);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].key, 'sharpforge.explorer.App');
});

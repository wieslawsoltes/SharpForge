import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, storageKeys } from '../apps/studio/settings/storage.js';
import { createCommandRegistry } from '../apps/studio/commands/registry.js';
import { DockLayout } from '@sharpforge/docking';
import { ToolWindowFactories } from '../apps/studio/workbench/window-factories.js';
import { installWatchWindows } from '../apps/studio/workbench/watch-windows/index.js';
import { WatchWindowState } from '../apps/studio/workbench/watch-windows/state.js';
import { importStudioFiles } from '../apps/studio/workbench/studio-file-import.js';
import { loadStudioWorkspace } from '../apps/studio/workbench/studio-workspace-loader.js';
import { createStudioRecords } from '../apps/studio/workbench/workspace-records.js';
import { studioLoaderFixture } from './support/studio-loader-fixture.js';
import { sessionDomRoot } from './a19-session-dom-fixture.js';

function persistedStorage(initial = []) {
  const values = new Map(initial);
  const errors = [];
  const backend = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const storage = createStorage({ provider: () => backend, onError: error => errors.push(error) });
  return { storage, backend, values, errors };
}

function studioWatchFixture(t, persisted = persistedStorage()) {
  const root = studioLoaderFixture(t);
  const layout = new DockLayout();
  const content = new Map();
  const host = { element: sessionDomRoot(), popouts: new Map(), autoPanel: null };
  const factories = new ToolWindowFactories({ layout, content });
  const docking = {
    layout, content, host,
    registerToolKind: (...args) => factories.register(...args),
    createTool: (...args) => factories.create(...args),
    activate: id => layout.open(id),
    unregisterPanel: id => { layout.unregister(id); content.delete(id); }
  };
  const commands = createCommandRegistry();
  const watches = installWatchWindows({ docking, sessions: root.services.sessions, commands,
    storage: persisted.storage, onError: error => root.calls.errors.push(error) });
  t.after(() => { watches.dispose(); commands.dispose(); });
  const imports = {
    state: root.state,
    withLoad: async action => {
      const load = root.context.workspaceLoads.begin({ state: root.state, documents: root.services.documents });
      try { return await action(load); }
      finally { load.finish(); }
    },
    loadRecords: (records, options) => loadStudioWorkspace(records, { ...options, updateOnly: true }, root.context),
    workspaceSettings: () => ({ name: root.state.name, mode: root.state.workspaceMode,
      active: root.state.active, tabs: [...root.state.tabs] }),
    records: () => createStudioRecords({ state: root.state, documents: root.services.documents })
  };
  return { ...root, persisted, watches, commands, imports };
}

test('production Watch storage initializes before a real File import without an error toast', async t => {
  const fixture = studioWatchFixture(t);
  assert.deepEqual(fixture.calls.errors, [], 'Watch startup must not emit a pre-existing error that blocks the browser import check');
  const id = await fixture.commands.execute('window.watch2');
  const watch = fixture.watches.get(id).model;
  await watch.add('retainedExpression');
  const oldModel = fixture.services.documents.models.get('Old.cs');
  const text = '// imported through the production source reader\nclass Imported {}\n';
  const result = await importStudioFiles([new File([text], 'Imported.cs')], {}, fixture.imports);
  assert.equal(result.committed, true);
  const record = fixture.services.documents.require('Imported.cs');
  assert.equal(record.text, text);
  assert.equal(record.byteLength, new TextEncoder().encode(text).byteLength);
  assert.equal(record.source, fixture.services.documents.models.get('Imported.cs').snapshot());
  assert.equal(fixture.services.documents.models.get('Old.cs'), oldModel);
  assert.equal(fixture.state.active, 'Imported.cs');
  assert.deepEqual(watch.expressions, ['retainedExpression']);
  assert.deepEqual(fixture.calls.errors, []);
  assert.deepEqual(fixture.persisted.errors, []);
  assert.deepEqual(JSON.parse(fixture.persisted.values.get(storageKeys.watchWindows)), {
    version: 1, windows: { 'tool:watch:2': { expressions: ['retainedExpression'], target: 'active' } }
  });
  fixture.watches.dispose();
  assert.equal(fixture.commands.describe('window.watch2'), null);
  assert.equal(watch.disposed, true);
});

test('the registered v1 key restores Watch expressions through the actual installation boundary', async t => {
  const saved = { version: 1, windows: { 'tool:watch:3': { expressions: ['existing'], target: 'active' } } };
  const persisted = persistedStorage([[storageKeys.watchWindows, JSON.stringify(saved)]]);
  const fixture = studioWatchFixture(t, persisted);
  const id = await fixture.commands.execute('window.watch3');
  assert.deepEqual(fixture.watches.get(id).model.expressions, ['existing']);
  assert.deepEqual(fixture.calls.errors, []);
  assert.deepEqual(persisted.errors, []);
  assert.equal(storageKeys.watchWindows, 'sharpforge.watch-windows.v1', 'The persisted identifier remains compatible');
});

test('registering Watch storage preserves the exact allowlist and exposes corrupt persisted payloads', () => {
  const persisted = persistedStorage([[storageKeys.watchWindows, '{invalid JSON']]);
  const errors = [];
  const state = new WatchWindowState({ storage: persisted.storage, onError: error => errors.push(error) });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, 'SyntaxError');
  assert.equal(state.get('tool:watch:2'), null);
  for (const key of ['sharpforge.watch-windows.v2', 'sharpforge.watch-windows.v1.extra', 'unregistered']) {
    assert.throws(() => persisted.storage.getItem(key), /Unregistered storage key/);
    assert.throws(() => persisted.storage.setItem(key, '{}'), /Unregistered storage key/);
  }
  state.set('tool:watch:2', { expressions: ['valid'], target: 'active' });
  assert.deepEqual(state.get('tool:watch:2'), { expressions: ['valid'], target: 'active' });
});

test('real storage quota failures retain previous Watch state and remain explicit', () => {
  const persisted = persistedStorage();
  const state = new WatchWindowState({ storage: persisted.storage });
  state.set('tool:watch:2', { expressions: ['before'], target: 'active' });
  const previous = persisted.values.get(storageKeys.watchWindows);
  persisted.backend.setItem = () => {
    const error = new Error('Storage is full');
    error.name = 'QuotaExceededError';
    throw error;
  };
  assert.throws(() => state.set('tool:watch:2', { expressions: ['after'], target: 'active' }), {
    name: 'StorageFailure', code: 'quota', key: storageKeys.watchWindows
  });
  assert.deepEqual(state.get('tool:watch:2'), { expressions: ['before'], target: 'active' });
  assert.equal(persisted.values.get(storageKeys.watchWindows), previous);
  assert.equal(persisted.errors.length, 1);
});

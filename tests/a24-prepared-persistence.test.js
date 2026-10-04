import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceConflictCoordinator, hashWorkspaceRecord} from '@sharpforge/workspace';
import {ExplorerPersistence} from '../apps/studio/explorer/persistence.js';
import {createLegacyWorkspaceBundle} from '../apps/studio/workspace-bundle.js';
import {prepared} from './support/prepared-workspace-record.js';
import {memoryDirectory} from './support/memory-directory-handle.js';

test('Explorer revision observation and checkpointing never flatten prepared buffers', async () => {
  const first = prepared('A.cs', 'first');
  const state = {identity: 'prepared:1', name: 'Prepared', records: [first], folders: [], tabs: ['A.cs']};
  const persistence = new ExplorerPersistence({getData: () => state,
    environment: {crypto: {randomUUID: () => 'window'}, navigator: {storage: {getDirectory: async () => memoryDirectory()}}}});
  try {
    persistence.observe(state);
    await persistence.revisionQueue;
    assert.equal(persistence.documentFor('A.cs').hash, await hashWorkspaceRecord(first));
    await persistence.checkpoint(state);
    assert.equal((await persistence.store.load()).record.records[0].source.getText(), 'first');
    assert.equal(first.source.statistics.textMaterialized, false);
  } finally { persistence.dispose(); }
});

test('conflict contents are read only after explicit resolution and a changed local revision remains protected', async () => {
  let reads = 0;
  let local = {path: 'A.cs', revision: 2, hash: await hashWorkspaceRecord({text: 'mine'})};
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    async readLocal(observed) { reads++; return {...observed, content: 'mine', baseContent: 'base'}; },
    applyResolution() { throw new Error('must not commit a stale result'); }, channel: {publishRevision() {}}});
  const remote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceRecord({text: 'theirs'})};
  coordinator.observe(remote);
  assert.equal(reads, 0);
  await assert.rejects(coordinator.resolve('A.cs', 'keep-mine', {readRemote: async () => {
    local = {...local, revision: 4};
    return {content: 'theirs', bytes: new TextEncoder().encode('theirs')};
  }}), /Local document changed/);
  assert.equal(reads, 1);
  assert(coordinator.conflicts.has('A.cs'));
});

test('legacy bundle export preserves sanitized startup/profile metadata with an immutable source record', () => {
  const record = prepared('A.cs', 'class A {}');
  const settings = {
    startupConfiguration: {version: 1, mode: 'single', entries: [{projectId: '$workspace', action: 'start'}]},
    launchProfiles: {version: 1, projects: [{projectId: '$workspace', profiles: [{id: 'default',
      name: 'Safe profile', args: ['must-not-export'], environment: {TOKEN: 'must-not-export'}}]}]}
  };
  const value = JSON.parse(createLegacyWorkspaceBundle({records: [record], settings}));
  assert.equal(value.startupConfiguration.entries[0].projectId, '$workspace');
  assert.equal(value.launchProfiles.projects[0].profiles[0].name, 'Safe profile');
  assert(!JSON.stringify(value).includes('must-not-export'));
  assert.equal(value.files[0].text, 'class A {}');
  assert.equal(record.source.statistics.textMaterialized, false);
});


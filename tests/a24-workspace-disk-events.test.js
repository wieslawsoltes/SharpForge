import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWorkspaceFile} from '@sharpforge/project-system';
import {hashFileBytes} from '@sharpforge/workspace';
import {applyExternalDiskChange} from '../apps/studio/workspace-disk-events.js';
import {application, directoryFiles} from './support/workspace-application.js';

test('versionless imported text reloads at version zero independently of the workspace revision', async () => {
  const {disk, provider} = await directoryFiles([['notes.txt', 'Before']]);
  const app = application();
  await app.session.load(disk.records, {disk, mode: 'folder'});
  delete app.state.extraFiles.find(record => record.path === 'notes.txt').version;
  app.state.revision = 17;
  const bytes = new TextEncoder().encode('After');
  await provider.writeFile('notes.txt', bytes);
  const record = decodeWorkspaceFile('notes.txt', bytes);
  const result = await applyExternalDiskChange(app.host, app.session, {path: record.path, record, expectedVersion: 0, revision: 17});
  assert.equal(result.applied, true);
  assert.equal(result.reevaluated, true);
  assert.equal(app.host.context().records.find(file => file.path === record.path).text, 'After');
  assert.equal(app.host.context().records.find(file => file.path === record.path).version, 1);
  assert.equal(disk.baselineHashes.get(record.path), await hashFileBytes(bytes));
  assert.equal(app.state.dirtyFiles.size, 0);
});

test('version-zero fallback still rejects stale workspace revisions and identity changes during reload preparation', async () => {
  const {disk} = await directoryFiles([['notes.txt', 'Before']]);
  const app = application();
  await app.session.load(disk.records, {disk, mode: 'folder'});
  delete app.state.extraFiles.find(record => record.path === 'notes.txt').version;
  app.state.revision = 17;
  const payload = {path: 'notes.txt', record: {path: 'notes.txt', text: 'After'}, expectedVersion: 0};
  await assert.rejects(applyExternalDiskChange(app.host, app.session, {...payload, revision: 16}), /Workspace changed/);
  const context = app.host.context;
  let reads = 0;
  const host = {...app.host, context: () => ({...context(), identity: ++reads < 3 ? 'original' : 'replacement'})};
  await assert.rejects(applyExternalDiskChange(host, app.session, {...payload, revision: 17}), /Workspace changed/);
  assert.equal(app.host.context().records.find(file => file.path === payload.path).text, 'Before');
  assert.equal(disk.record(payload.path).text, 'Before');
});

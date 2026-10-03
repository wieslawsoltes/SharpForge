import test from 'node:test';
import assert from 'node:assert/strict';
import {explorerViewPolicy, MAX_EAGER_EXPLORER_ENTRIES} from '../apps/studio/explorer/view-policy.js';

test('A24 large default solution views choose visible paging without traversing file records', () => {
  const records = new Proxy({length: 20000}, {get: (target, property) => {
    assert.equal(property, 'length', 'view selection must not inspect individual files');
    return target.length;
  }});
  const data = {records, snapshot: {projects: [{path: 'App.csproj'}]}};
  const policy = explorerViewPolicy(data);
  assert.equal(policy.view, 'folders');
  assert.equal(policy.lazy, true);
  assert.equal(policy.large, true);
  assert.match(policy.reason, /paged Folder view/);
  assert.equal(data.snapshot.projects[0].path, 'App.csproj');
});

test('A24 folder paging preserves the eager boundary and the requested view for smaller workspaces', () => {
  const records = {length: MAX_EAGER_EXPLORER_ENTRIES};
  const data = {records, snapshot: {projects: []}};
  assert.deepEqual(explorerViewPolicy(data), {view: 'solution', lazy: false, large: false, reason: null});
  assert.equal(explorerViewPolicy(data, 'folders').view, 'folders');
  assert.equal(explorerViewPolicy({...data, folders: ['empty']}).lazy, true);
  assert.equal(explorerViewPolicy({...data, records: {length: records.length + 1}}).large, true);
  assert.equal(explorerViewPolicy({records: [], disk: {lazy: true}}).lazy, true);
  assert.equal(explorerViewPolicy({...data, disk: {lazy: true}}).lazy, false);
});

test('A24 linked project appearances, generated files and imports also trigger bounded views', () => {
  const compile = new Proxy({length: 20000}, {get: (target, property) => {
    assert.equal(property, 'length', 'view selection must not enumerate Compile items');
    return target.length;
  }});
  assert.equal(explorerViewPolicy({files: [], snapshot: {projects: [{compile}]}}).large, true);
  assert.equal(explorerViewPolicy({files: [], snapshot: {projects: [
    {compile: {length: 1100}}, {compile: {length: 1100}}
  ]}}).large, true);
  assert.equal(explorerViewPolicy({generated: {length: 2001}}).large, true);
  assert.equal(explorerViewPolicy({snapshot: {projects: [{imports: {length: 2000}}]}}).large, true);
  assert.equal(explorerViewPolicy({snapshot: {projects: [{generatedSources: {length: 2000}}]}}).large, true);
});

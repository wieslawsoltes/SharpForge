import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWorkspaceFile} from '@sharpforge/project-system';
import {application, directoryFiles} from './support/workspace-application.js';

test('opening a metadata-only directory loads the active source and keeps thousands of other buffers unopened', async () => {
  const app = application();
  const records = Array.from({length: 1200}, (_, index) => ({path: 'C' + index + '.cs', size: 12, lazy: true}));
  const reads = [];
  const disk = {name: 'Large', folders: [], records, handles: new Map(), record: path => records.find(file => file.path === path),
    load: async path => { reads.push(path); return {path, text: 'class Empty {}', version: 1}; }};
  await app.session.load(records, {disk, mode: 'folder'});
  assert.deepEqual(reads, ['C0.cs']);
  assert.equal(app.state.files.length, 1);
  assert.equal(app.host.context().records.length, 1200);
  assert.equal(app.events.includes('build'), false);
  assert.equal(app.state.dirtyFiles.size, 0);
  assert.deepEqual(app.state.tabs, ['C0.cs']);
});

test('workspace admission permits more than 100 small sources and preserves the old model on invalid replacement', async () => {
  const app = application();
  await app.session.load(Array.from({length: 150}, (_, index) => ({path: 'C' + index + '.cs', text: 'class C' + index + ' {}'})),
    {mode: 'folder'});
  assert.equal(app.state.files.length, 150);
  const revision = app.state.revision;
  await assert.rejects(app.session.load([{path: 'missing.cs', size: 1, lazy: true}], {mode: 'folder'}), /contents are unavailable/);
  await assert.rejects(app.session.load([{path: '../outside.cs', text: ''}], {mode: 'folder'}), /path/i);
  assert.equal(app.state.revision, revision);
  assert.equal(app.state.files.length, 150);
});

test('resource naming and file references hydrate before the selected project snapshot becomes visible', async () => {
  const {disk} = await directoryFiles([
    ['App.csproj', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'],
    ['Strings.cs', 'namespace Example; public class Strings {}'], ['data.bin', Uint8Array.of(0, 255, 12)],
    ['Strings.resx', '<root><data name="Bytes" type="System.Resources.ResXFileRef, System.Windows.Forms">' +
      '<value>data.bin;System.Byte[], System.Private.CoreLib</value></data></root>'],
  ], {lazy: true});
  const app = application();
  await app.session.load(disk.records, {disk, entry: 'App.csproj'});
  const project = app.state.projectSystem.projects.get('App.csproj');
  assert.equal(project.resources[0].manifestName, 'Example.Strings.resources');
  assert.deepEqual(project.resources[0].entries[0].value, Uint8Array.of(0, 255, 12));
  assert.equal(app.state.projectSnapshot.diagnostics.some(item => item.code === 'SFP1501'), false);
});

test('a committed structural edit remaps editor state and retains only explicitly unsaved paths', async () => {
  const app = application();
  await app.session.load([{path: 'A.cs', text: 'class A {}'}, {path: 'B.cs', text: 'class B {}'}], {mode: 'folder'});
  app.state.active = 'A.cs';
  app.state.tabs = ['A.cs', 'B.cs'];
  app.state.breakpoints = {'A.cs': [{line: 1}]};
  app.state.files.find(file => file.uri === 'B.cs').text = 'class Unsaved {}';
  app.state.dirtyFiles.add('B.cs');
  await app.session.commit({records: [{path: 'Renamed.cs', text: 'class A {}'}, {path: 'B.cs', text: 'class Unsaved {}'}],
    mappings: [{from: 'A.cs', to: 'Renamed.cs'}], diskCommitted: true, persistedPaths: ['Renamed.cs'], dirty: ['B.cs']});
  assert.equal(app.state.active, 'Renamed.cs');
  assert.deepEqual(app.state.tabs, ['Renamed.cs', 'B.cs']);
  assert.deepEqual(app.state.breakpoints['Renamed.cs'], [{line: 1}]);
  assert.deepEqual([...app.state.dirtyFiles], ['B.cs']);
  assert.equal(app.state.membershipDirty, false);
});

test('permission-denied recent workspaces recover loaded content read-only and never synthesize missing source', async () => {
  const app = application();
  await app.session.reopenRecent({permission: 'denied', readOnly: true, record: {name: 'Recovery', folders: [],
    records: [{path: 'A.cs', text: 'class A {}'}, {path: 'B.cs', lazy: true, size: 12}], settings: {mode: 'folder'},
    openDocuments: [{path: 'A.cs'}]}});
  assert.equal(app.state.readOnly, true);
  assert.deepEqual(app.state.files.map(file => file.uri), ['A.cs']);
  await assert.rejects(app.session.loadRecord('B.cs'), /Grant folder access/);
  await assert.rejects(app.session.save(), /read-only/);
  const restored = app.host.context().records.find(record => record.path === 'A.cs');
  assert.deepEqual(encodeWorkspaceFile(restored), new TextEncoder().encode('class A {}'));
});

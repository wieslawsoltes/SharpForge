import test from 'node:test';
import assert from 'node:assert/strict';
import {ExplorerCommands} from '../apps/studio/explorer-commands.js';
import {copyDestination} from '../apps/studio/explorer/clipboard.js';
import {inspectMoveBatch} from '../apps/studio/explorer/guards.js';
import {ProjectSystem} from '@sharpforge/project-system';

function fixture(records, extra = {}) {
  let context = {identity: 'test', name: 'Test', records, folders: [], tabs: [], breakpoints: {}, ...extra};
  const notices = [];
  const host = {context: () => context, render() {}, error(error) { notices.push(error.message); }, notice(text) { notices.push(text); },
    confirm: async () => true, pathDialog: async () => null, choose: async () => null,
    commit: async value => { context = {...context, ...value}; }, open: async () => {}};
  return {commands: new ExplorerCommands(host), host, context: () => context, notices};
}

test('A24 same-folder copy assigns portable collision names and redo retains binary bytes', async () => {
  assert.equal(copyDestination('A.cs', new Set(['A.cs'])), 'A - Copy.cs');
  assert.equal(copyDestination('A.cs', new Set(['A.cs', 'a - copy.cs'])), 'A - Copy (2).cs');
  const bytes = Uint8Array.from([0, 255, 128, 1]);
  const value = fixture([{path: 'A.bin', bytes}]);
  const file = {path: 'A.bin', kind: 'file'};
  await value.commands.run('copy', file);
  await value.commands.run('paste', {kind: 'workspace'});
  assert.deepEqual(value.context().records.find(record => record.path === 'A - Copy.bin').bytes, bytes);
  await value.commands.undo();
  assert.equal(value.context().records.length, 1);
  await value.commands.redo();
  assert.deepEqual(value.context().records.find(record => record.path === 'A - Copy.bin').bytes, bytes);
});

test('A24 project rename updates solution and dependent references in a single undoable transaction', async () => {
  const records = [{path: 'Demo.slnx', text: '<Solution><Project Path="App/App.csproj"/><Project Path="Other/Other.csproj"/></Solution>'},
    {path: 'App/App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"/>'},
    {path: 'Other/Other.csproj', text: '<Project><ItemGroup><ProjectReference Include="../App/App.csproj"/></ItemGroup></Project>'}];
  const value = fixture(records, {solutionPath: 'Demo.slnx'});
  await value.commands.move([{from: 'App/App.csproj', to: 'App/Renamed.csproj'}], false, null, {allowProjectRename: true});
  assert(value.context().records.some(record => record.path === 'App/Renamed.csproj'));
  assert(value.context().records.find(record => record.path === 'Demo.slnx').text.includes('App/Renamed.csproj'));
  assert(value.context().records.find(record => record.path === 'Other/Other.csproj').text.includes('../App/Renamed.csproj'));
  await value.commands.undo();
  assert.deepEqual(value.context().records, records);
});

test('A24 linked-file workflow changes project metadata without copying bytes', async () => {
  const records = [{path: 'Shared/A.cs', text: 'class A {}'}, {path: 'App/App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"/>'}];
  const value = fixture(records);
  const target = {kind: 'folder', path: 'App/Links', project: 'App/App.csproj'};
  await value.commands.run('link-to', target, [{kind: 'source', path: 'Shared/A.cs'}]);
  assert.equal(value.context().records.length, 2);
  const project = new ProjectSystem(value.context().records).load('App/App.csproj').projects[0];
  assert(project.compile.some(item => item.path === 'Shared/A.cs' && item.metadata.Link === 'Links/A.cs'));
});

test('A24 invalid batch items require explicit partial confirmation and are reported', async () => {
  const value = fixture([{path: 'A.cs', text: ''}, {path: 'B.cs', text: ''}]);
  const mappings = [{from: 'A.cs', to: 'C.cs'}, {from: 'B.cs', to: 'B.cs/child'}];
  const inspected = inspectMoveBatch(value.context(), mappings);
  assert.equal(inspected[1].status, 'rejected');
  let prompts = 0;
  value.host.confirm = async () => { prompts++; return false; };
  await value.commands.move(mappings, false);
  assert(value.context().records.some(record => record.path === 'A.cs'));
  value.host.confirm = async () => { prompts++; return true; };
  const result = await value.commands.move(mappings, false);
  assert.equal(prompts, 2);
  assert.equal(result.completed.length, 1);
  assert.equal(result.rejected.length, 1);
  assert(value.context().records.some(record => record.path === 'B.cs'));
});

test('A24 unsafe project folder moves reject before commit', async () => {
  const value = fixture([{path: 'App/App.csproj', text: '<Project/>'}, {path: 'App/A.cs', text: ''}]);
  await assert.rejects(value.commands.move([{from: 'App', to: 'Other/App'}], false), /unsafe project move/);
  assert.equal(value.context().records[0].path, 'App/App.csproj');
});

test('A24 external drop imports exact bytes through the shared history', async () => {
  const value = fixture([]);
  const bytes = Uint8Array.from([255, 0, 128]);
  await value.commands.run('import-drop', {kind: 'workspace'}, [],
    {files: [{name: 'image.bin', size: bytes.length, arrayBuffer: async () => bytes.buffer}]});
  assert.deepEqual(value.context().records[0].bytes, bytes);
  await value.commands.undo();
  assert.equal(value.context().records.length, 0);
  await value.commands.run('import-drop', {kind: 'workspace'}, [],
    {files: [{name: 'bad.bin', size: 1, arrayBuffer: async () => bytes.buffer}]});
  assert(value.notices.some(message => message.includes('changed during import')));
  assert.equal(value.context().records.length, 0);
});

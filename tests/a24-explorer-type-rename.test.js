import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {ExplorerCommands} from '../apps/studio/explorer-commands.js';
import {prepareExplorerTypeRename, typeRenameOperations} from '../apps/studio/explorer/type-rename.js';

function explorerFixture(accepted) {
  const records = [{path: 'App.csproj', text: '<Project><ItemGroup><Compile Include="Widget.cs"/><Compile Include="Use.cs"/></ItemGroup></Project>'},
    {path: 'Widget.cs', text: 'class Widget {}'}, {path: 'Use.cs', text: 'class Use { Widget value; }'}];
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  for (const record of records.filter(record => record.path.endsWith('.cs'))) workspace.update(record.path, record.text);
  const language = new LanguageService(workspace);
  let context = {identity: 'rename-test', records, folders: [], dirty: [], tabs: ['Widget.cs'], active: 'Widget.cs'};
  const notices = [];
  const host = {context: () => context, render() {}, error: error => notices.push(error.message), notice: text => notices.push(text),
    pathDialog: async () => 'Renamed.cs', confirm: async () => accepted, commit: async next => { context = {...context, ...next}; },
    prepareTypeRename: request => prepareExplorerTypeRename(context, (_method, params) =>
      language.prepareTypeRename(params.uri, null, params.newName, {name: params.name}), request)};
  return {commands: new ExplorerCommands(host), host, context: () => context, records, notices};
}

test('A24 accepted type/file/project rename is one undo entry and decline preserves type spelling', async () => {
  for (const accepted of [true, false]) {
    const fixture = explorerFixture(accepted);
    await fixture.commands.run('rename', {path: 'Widget.cs', kind: 'source'});
    const records = fixture.context().records;
    assert.equal(records.find(record => record.path === 'Renamed.cs').text, accepted ? 'class Renamed {}' : 'class Widget {}');
    assert(records.find(record => record.path === 'App.csproj').text.includes('Compile Include="Renamed.cs"'));
    assert.equal(records.find(record => record.path === 'Use.cs').text, accepted ? 'class Use { Renamed value; }' : 'class Use { Widget value; }');
    await fixture.commands.undo();
    assert.deepEqual(fixture.context().records, fixture.records);
    await fixture.commands.redo();
    assert(fixture.context().records.some(record => record.path === 'Renamed.cs'));
  }
});

test('A24 changing any semantic input while the confirmation is open rejects the whole rename', async () => {
  const fixture = explorerFixture(true);
  fixture.host.confirm = async () => {
    fixture.context().records.find(record => record.path === 'Use.cs').text += '\nclass Added {}';
    return true;
  };
  const result = await fixture.commands.run('rename', {path: 'Widget.cs', kind: 'source'});
  assert.match(result.error, /changed/);
  assert(fixture.context().records.some(record => record.path === 'Widget.cs'));
  assert.equal(fixture.context().records.find(record => record.path === 'App.csproj').text, fixture.records[0].text);
});

test('A24 host refuses separate project contexts and native semantic gaps without invoking a worker', async () => {
  for (const context of [{native: true}, {snapshot: {projects: [{path: 'A.csproj'}, {path: 'B.csproj'}]}},
    {snapshot: {projects: [{targetFrameworks: ['net8.0', 'net10.0']}]}}]) {
    const plan = await prepareExplorerTypeRename(context, () => { throw new Error('Unexpected worker call'); },
      {uri: 'Widget.cs', oldName: 'Widget', newName: 'Renamed'});
    assert.equal(plan.available, false);
    assert.equal(plan.diagnostic.code, 'SFL2401');
  }
});

test('A24 type rename refuses an edit extending one character past the reviewed document', async () => {
  const source = 'class Widget {}';
  const commands = {readText: async () => source};
  await assert.rejects(typeRenameOperations(commands, {documents: [{uri: 'Widget.cs', text: source}],
    edits: [{uri: 'Widget.cs', start: source.length, end: source.length + 1, newText: 'X'}]}), /invalid|overlap/i);
});

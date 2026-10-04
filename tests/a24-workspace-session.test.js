import test from 'node:test';
import assert from 'node:assert/strict';
import {scanDirectory, decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/project-system';
import {hashFileBytes} from '@sharpforge/workspace';
import {applyExternalDiskChange, reevaluateDiskWorkspace} from '../apps/studio/workspace-disk-events.js';
import {exportWorkspaceToWritable} from '../apps/studio/workspace-export.js';
import {commitWorkspaceWizard} from '../apps/studio/workspace-wizard.js';
import {createLegacyWorkspaceBundle} from '../apps/studio/workspace-bundle.js';
import {ExplorerCommands} from '../apps/studio/explorer/commands.js';
import {registerStudioCommands} from '../apps/studio/commands/core.js';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {readZip} from '@sharpforge/archive';
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

test('Save to Disk preserves encodings and saves source, project XML, and binary changes together', async () => {
  const utf16 = Uint8Array.of(255, 254, 111, 0, 108, 0, 100, 0);
  const {disk, provider} = await directoryFiles([['A.cs', 'class A {}'], ['notes.txt', utf16], ['asset.bin', Uint8Array.of(1, 2)]]);
  const app = application();
  await app.session.load(disk.records, {disk, mode: 'folder'});
  app.state.files[0].text = 'class Changed {}';
  app.state.dirtyFiles.add('A.cs');
  app.state.extraFiles.find(record => record.path === 'notes.txt').text = 'new';
  app.state.extraFiles.find(record => record.path === 'asset.bin').bytes = Uint8Array.of(0, 255, 3);
  const result = await app.session.save();
  assert.deepEqual(result.written.toSorted(), ['A.cs', 'asset.bin', 'notes.txt']);
  assert.deepEqual(await provider.readFile('notes.txt'), Uint8Array.of(255, 254, 110, 0, 101, 0, 119, 0));
  assert.deepEqual(await provider.readFile('asset.bin'), Uint8Array.of(0, 255, 3));
  assert.equal(app.state.dirtyFiles.size, 0);
  assert.deepEqual((await app.session.save()).written, []);
});

test('external reload rejects a stale decision and then adopts accepted bytes without marking them dirty', async () => {
  const {disk, provider} = await directoryFiles([['A.cs', 'class A {}']]);
  const app = application();
  await app.session.load(disk.records, {disk, mode: 'folder'});
  const bytes = new TextEncoder().encode('class External {}');
  await provider.writeFile('A.cs', bytes);
  const record = {...decodeWorkspaceFile('A.cs', bytes), hash: await hashFileBytes(bytes)};
  const payload = {path: 'A.cs', record, event: {type: 'changed', path: 'A.cs'}, expectedVersion: 99};
  await assert.rejects(applyExternalDiskChange(app.host, app.session, payload), /changed after/);
  assert.equal(app.state.files[0].text, 'class A {}');
  const commands = new ExplorerCommands({...app.host, error: error => { throw error; },
    workspaceAction: (action, node, event) => {
      assert.equal(action, 'disk-external-change');
      assert.equal(node.path, payload.path);
      return applyExternalDiskChange(app.host, app.session, event);
    }});
  await commands.run('disk-external-change', {path: payload.path}, [], {...payload, expectedVersion: app.state.files[0].version});
  assert.equal(app.state.files[0].text, 'class External {}');
  assert.equal(app.state.dirtyFiles.size, 0);
  assert.equal(disk.baselineHashes.get('A.cs'), record.hash);
  commands.dispose();
});

test('metadata rescans preserve a dirty file removed externally so its later save detects the conflict', async () => {
  const {disk, provider} = await directoryFiles([['A.cs', 'class A {}'], ['B.cs', 'class B {}']]);
  const app = application();
  await app.session.load(disk.records, {disk, mode: 'folder'});
  app.state.files.find(file => file.uri === 'B.cs').text = 'class Unsaved {}';
  app.state.dirtyFiles.add('B.cs');
  await provider.delete('B.cs');
  const commands = new ExplorerCommands({...app.host, error: error => { throw error; },
    workspaceAction: (action, node, event) => {
      assert.equal(action, 'disk-reevaluate');
      return reevaluateDiskWorkspace(app.host, app.session, event);
    }});
  await commands.run('disk-reevaluate', {path: ''}, [], {rescan: true, path: '', records: [disk.record('A.cs')], folders: []});
  assert.equal(app.state.files.find(file => file.uri === 'B.cs').text, 'class Unsaved {}');
  assert.ok(app.state.dirtyFiles.has('B.cs'));
  assert.ok(app.host.context().records.some(record => record.path === 'B.cs'));
  await assert.rejects(app.session.save(), /conflict|changed/i);
  commands.dispose();
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

test('metadata-only project rescans hydrate XML before evaluation and adopt observed physical baselines', async () => {
  const project = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>';
  const props = company => '<Project><PropertyGroup><Company>' + company + '</Company></PropertyGroup></Project>';
  const {disk, provider} = await directoryFiles([['App.csproj', project], ['Directory.Build.props', props('Before')],
    ['A.cs', 'class A {}'], ['Unopened.cs', 'class Unopened {}']], {lazy: true});
  const app = application();
  await app.session.load(disk.records, {disk, entry: 'App.csproj'});
  const bytes = new TextEncoder().encode(props('After'));
  await provider.writeFile('Directory.Build.props', bytes);
  const scanned = await scanDirectory(provider);
  assert.ok(scanned.records.every(record => record.lazy));
  await reevaluateDiskWorkspace(app.host, app.session, {rescan: true, ...scanned});
  assert.equal(app.state.projectSystem.projects.get('App.csproj').properties.company, 'After');
  assert.equal(disk.baselineHashes.get('Directory.Build.props'), await hashFileBytes(bytes));
  assert.equal(disk.record('Directory.Build.props').text, props('After'));
  assert.equal(disk.record('Unopened.cs').lazy, true);
});

test('a stale rescan leaves the original project model and disk baselines unchanged', async () => {
  const project = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>';
  const {disk, provider} = await directoryFiles([['App.csproj', project], ['A.cs', 'class A {}']], {lazy: true});
  const app = application();
  await app.session.load(disk.records, {disk, entry: 'App.csproj'});
  const prior = app.state.projectSystem;
  const hash = disk.baselineHashes.get('App.csproj');
  await provider.writeFile('App.csproj', new TextEncoder().encode(project.replace('net10.0', 'net8.0')));
  const scanned = await scanDirectory(provider);
  const readFile = provider.readFile.bind(provider);
  provider.readFile = async (path, options) => {
    const bytes = await readFile(path, options);
    if (path === 'App.csproj') app.state.revision++;
    return bytes;
  };
  await assert.rejects(reevaluateDiskWorkspace(app.host, app.session, {rescan: true, ...scanned}), /Workspace changed/);
  assert.equal(app.state.projectSystem, prior);
  assert.equal(disk.baselineHashes.get('App.csproj'), hash);
  assert.equal(disk.record('App.csproj').text, project);
});

test('streaming ZIP export reads one lazy file at a time and aborts its sink after a stale workspace decision', async () => {
  const {disk} = await directoryFiles([['one.bin', Uint8Array.of(1, 2)], ['two.bin', Uint8Array.of(3, 4)]], {lazy: true});
  const context = {records: disk.records, folders: disk.folders, disk, provider: disk.provider, settings: {mode: 'folder'}};
  const chunks = [];
  let closed = false;
  await exportWorkspaceToWritable(context, {write: value => chunks.push(value.slice()), close: () => { closed = true; }});
  assert.equal(closed, true);
  assert.equal(disk.loadedBytes, 0, 'streaming reads never populate the retained editor cache');
  const zip = new Uint8Array(chunks.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const chunk of chunks) { zip.set(chunk, offset); offset += chunk.length; }
  assert.deepEqual(readZip(zip).find(entry => entry.path === 'two.bin').bytes, Uint8Array.of(3, 4));
  let aborted = false;
  await assert.rejects(exportWorkspaceToWritable(context, {write() {}, abort() { aborted = true; }}, {isCurrent: () => false}),
    /Workspace changed/);
  assert.equal(aborted, true);
});

test('JSON interchange includes hydrated folder files and preserves UTF-16 bytes with edited source text', () => {
  const source = decodeWorkspaceFile('Source.cs', Uint8Array.of(255, 254, 65, 0, 13, 0, 10, 0));
  source.text = 'B\r\n';
  const binary = {path: 'Data.bin', bytes: Uint8Array.of(0, 128, 255)};
  const value = JSON.parse(createLegacyWorkspaceBundle({records: [source, binary], folders: ['Empty'],
    settings: {name: 'Folder', mode: 'folder', active: 'Source.cs'}}));
  assert.equal(value.mode, 'folder');
  assert.deepEqual(value.files, [{uri: 'Source.cs', text: 'B\r\n'}]);
  assert.deepEqual(value.folders, ['Empty']);
  const decoded = value.diskRecords.map(record => Uint8Array.from(atob(record.base64), character => character.charCodeAt(0)));
  assert.deepEqual(decoded, [Uint8Array.of(255, 254, 66, 0, 13, 0, 10, 0), binary.bytes]);
  assert.throws(() => createLegacyWorkspaceBundle({records: [{path: 'Unread.cs', lazy: true, size: 12}]}),
    /must be loaded/, 'unopened files are never exported as empty strings');
});

test('the registered JSON export command returns asynchronous hydration failures to its caller', async () => {
  const registry = createCommandRegistry();
  registerStudioCommands(registry, {EDITOR_KEYMAPS: [], toolDefinitions: [], exportLegacyProject: async () => {
    await Promise.resolve();
    throw new Error('Original file bytes unavailable');
  }});
  await assert.rejects(registry.execute('exportLegacyProject'), /Original file bytes unavailable/);
  registry.dispose();
});

test('wizard application keeps the chosen physical folder attached and retains binary item records', async () => {
  const {disk} = await directoryFiles([['Program.cs', 'System.Console.WriteLine(42);'], ['image.png', Uint8Array.of(137, 80, 78, 71)]]);
  const app = application();
  const plan = {name: 'Wizard', template: 'fixture', records: disk.records, folders: [], openFile: 'Program.cs'};
  let opened;
  await commitWorkspaceWizard({state: app.state, context: app.host.context, confirm: () => true,
    load: (...args) => app.session.load(...args), open: node => { opened = node.path; }, render() {}, save() {}, log() {}},
  plan, {context: app.host.context(), kind: 'project', add: false, disk});
  assert.equal(app.state.disk, disk);
  assert.equal(opened, 'Program.cs');
  assert.deepEqual(app.host.context().records.find(record => record.path === 'image.png').bytes, Uint8Array.of(137, 80, 78, 71));
  let operations;
  await commitWorkspaceWizard({state: app.state, context: app.host.context, actions: {perform: value => { operations = value; }},
    open() {}, render() {}, save() {}, log() {}}, {template: 'binary', records: [{path: 'new.bin', bytes: Uint8Array.of(255, 0)}],
    folders: [], modifications: []}, {context: app.host.context(), kind: 'item', add: true});
  assert.deepEqual(operations[0].record.bytes, Uint8Array.of(255, 0));
  assert.equal(operations[0].text, undefined);
});

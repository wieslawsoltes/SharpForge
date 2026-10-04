import test from 'node:test';
import assert from 'node:assert/strict';
import {scanDirectory, decodeWorkspaceFile} from '@sharpforge/project-system';
import {hashFileBytes} from '@sharpforge/workspace';
import {applyExternalDiskChange, reevaluateDiskWorkspace} from '../apps/studio/workspace-disk-events.js';
import {ExplorerCommands} from '../apps/studio/explorer/commands.js';
import {application, directoryFiles} from './support/workspace-application.js';

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

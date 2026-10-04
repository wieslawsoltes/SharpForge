import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentReloadCoordinator} from '@sharpforge/workspace';
import {applyExternalDiskChange, reevaluateDiskWorkspace} from '../apps/studio/workspace-disk-events.js';
import {diskReloadCallbacks} from '../apps/studio/explorer/disk-services.js';
import {ExplorerCommands} from '../apps/studio/explorer/commands.js';
import {application, directoryFiles} from './support/workspace-application.js';

async function lazyApplication() {
  const source = await directoryFiles([['A.cs', 'class A {}'], ['B.cs', 'class B {}']], {lazy: true});
  const app = application();
  await app.session.load(source.disk.records, {disk: source.disk, mode: 'folder'});
  return {...source, ...app};
}

async function pauseLoad(app) {
  const original = app.disk.load.bind(app.disk);
  let ready, release;
  const started = new Promise(resolve => { ready = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  app.disk.load = async (path, options) => {
    const record = await original(path, options);
    ready();
    await barrier;
    return record;
  };
  const loading = app.session.loadRecord('B.cs');
  await started;
  return {loading, release};
}

const replacements = {
  delete: app => app.session.commit({records: app.host.context().records.filter(record => record.path !== 'B.cs')}),
  rename: app => app.session.commit({records: app.host.context().records.map(record =>
    record.path === 'B.cs' ? {...record, path: 'C.cs'} : record), mappings: [{from: 'B.cs', to: 'C.cs'}]}),
  metadata: app => {
    const index = app.state.extraFiles.findIndex(record => record.path === 'B.cs');
    app.state.extraFiles[index] = {...app.state.extraFiles[index], size: 99};
  },
  disk: app => { app.state.disk = Object.assign(Object.create(Object.getPrototypeOf(app.disk)), app.disk); },
  edit: app => {
    app.state.files[0].text = 'class Edited {}';
    app.state.files[0].version++;
    app.state.revision++;
  }
};

for (const [name, replace] of Object.entries(replacements)) {
  test('the application rejects a lazy read after same-workspace ' + name, async () => {
    const app = await lazyApplication();
    const {loading, release} = await pauseLoad(app);
    await replace(app);
    release();
    await assert.rejects(loading, {
      name: 'FileSystemError', code: 'Conflict', path: 'B.cs',
      message: 'Workspace changed while loading or closing a document: B.cs'
    });
    assert.equal(app.state.files.some(file => file.uri === 'B.cs'), false);
    const member = app.host.context().records.find(record => record.path === 'B.cs');
    if (name === 'delete' || name === 'rename') assert.equal(member, undefined);
    else assert.equal(member.lazy, true);
  });
}

test('a current lazy read publishes its bytes without opening another source editor or tab', async () => {
  const app = await lazyApplication();
  const record = await app.session.loadRecord('B.cs');
  assert.equal(record.text, 'class B {}');
  assert.equal(app.host.context().records.find(item => item.path === 'B.cs').text, record.text);
  assert.deepEqual(app.state.files.map(file => file.uri), ['A.cs']);
  assert.deepEqual(app.state.tabs, ['A.cs']);
});

async function watchedApplication({props = true} = {}) {
  const project = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>' +
    '<TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>';
  const records = [['App.csproj', project], ['A.cs', 'class A {}']];
  if (props) records.push(['Directory.Build.props', '<Project><PropertyGroup><Company>Before</Company></PropertyGroup></Project>']);
  const source = await directoryFiles(records);
  const app = application();
  await app.session.load(source.disk.records, {disk: source.disk, entry: 'App.csproj'});
  const commands = new ExplorerCommands({...app.host, error: error => { throw error; },
    workspaceAction: (action, _node, payload) => action === 'disk-external-change'
      ? applyExternalDiskChange(app.host, app.session, payload) : reevaluateDiskWorkspace(app.host, app.session, payload)});
  const reload = new DocumentReloadCoordinator({provider: source.provider, replaceDocument() {},
    getDocument: path => {
      const context = app.host.context();
      const record = context.records.find(item => item.path === path);
      return record ? {...record, version: record.version ?? context.revision, dirty: context.dirty.includes(path)} : null;
    }, ...diskReloadCallbacks((action, payload) => commands.run(action, {path: payload.path}, [], payload))});
  return {...source, ...app, reload, dispose: () => { reload.dispose(); commands.dispose(); }};
}

for (const dirty of [false, true]) {
  test('one accepted project watcher change commits and evaluates exactly once, dirty=' + dirty, async () => {
    const app = await watchedApplication();
    try {
      const path = 'Directory.Build.props';
      if (dirty) app.state.dirtyFiles.add(path);
      await app.provider.writeFile(path, new TextEncoder().encode(
        '<Project><PropertyGroup><Company>After</Company></PropertyGroup></Project>'));
      const revision = app.state.revision;
      await app.reload.handle({type: 'changed', path});
      if (dirty) {
        assert.equal(app.state.revision, revision, 'dirty documents require an explicit decision');
        await app.reload.choose(path, 'reload');
      }
      assert.equal(app.state.revision, revision + 1);
      assert.equal(app.state.projectSystem.projects.get('App.csproj').properties.company, 'After');
      assert.equal(app.state.dirtyFiles.has(path), false);
    } finally { app.dispose(); }
  });
}

test('project watcher creation and deletion still update membership when no editor is open', async () => {
  const app = await watchedApplication({props: false});
  try {
    const path = 'Directory.Build.props';
    await app.provider.writeFile(path, new TextEncoder().encode(
      '<Project><PropertyGroup><Company>Created</Company></PropertyGroup></Project>'));
    let revision = app.state.revision;
    await app.reload.handle({type: 'created', path});
    assert.equal(app.state.revision, revision + 1);
    assert.equal(app.state.projectSystem.projects.get('App.csproj').properties.company, 'Created');
    await app.provider.delete(path);
    revision = app.state.revision;
    await app.reload.handle({type: 'deleted', path});
    assert.equal(app.state.revision, revision + 1);
    assert.equal(app.host.context().records.some(record => record.path === path), false);
    assert.equal(app.disk.record(path), undefined);
  } finally { app.dispose(); }
});

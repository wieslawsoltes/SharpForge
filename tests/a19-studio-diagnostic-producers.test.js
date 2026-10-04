import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem } from '@sharpforge/project-system';
import { DesignDocument } from '@sharpforge/designer';
import { StudioProjects } from '../apps/studio/workbench/studio-projects.js';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { ErrorListModel } from '../apps/studio/workbench/tools/error-list.js';
import { designerConfiguration } from '../apps/studio/workbench/lazy-features/designer-configuration.js';
import { DesignerSourceSync } from '../apps/studio/designer-source-sync.js';
import { DesignerTools } from '../apps/studio/designer-tools.js';
import { fakeWorkers, compileResult, deferred } from './a19-session-fixtures.js';

const design = `using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
class View {
  public static Window Create() {
    Window window = new Window();
    Canvas panel = new Canvas();
    Button action = new Button() { Width = ComputeWidth(), Height = 40 };
    panel.Children.Add(action); window.Content = panel; window.Activate();
    return window;
  }
}`;

function fixture(t) {
  const project = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>'
    + '<TargetFrameworks>net9.0;net10.0</TargetFrameworks></PropertyGroup></Project>';
  const records = [
    { path: 'Apps.slnx', text: '<Solution><Project Path="A/A.csproj"/><Project Path="B/B.csproj"/></Solution>' },
    { path: 'A/A.csproj', text: project.replace('</Project>',
      '<Import Project="Shared.props"/><Import Project="Shared.props"/></Project>') },
    { path: 'A/Shared.props', text: '<Project />' },
    { path: 'B/B.csproj', text: project.replace('net9.0;net10.0', 'net10.0') },
    { path: 'A/View.cs', text: design }, { path: 'B/View.cs', text: design }
  ];
  const system = new ProjectSystem(records);
  const snapshot = system.load('Apps.slnx');
  const workers = fakeWorkers(() => compileResult());
  let projects;
  const services = createWorkbenchServices({ workerFactory: workers.factory,
    records: records.filter(record => record.path.endsWith('.cs')).map(record => ({ uri: record.path, text: record.text, version: 1 })),
    getProjectSnapshot: id => projects.snapshot(id) });
  const state = { projectSystem: system, projectSnapshot: snapshot, files: services.documents.files,
    startupProject: 'A/A.csproj', active: 'A/View.cs', name: 'Apps', workspaceEpoch: 1, configuration: 'Debug',
    readOnly: false, revision: 1 };
  projects = new StudioProjects(services, { state: () => state });
  projects.sync();
  const errors = new ErrorListModel({ diagnostics: services.diagnostics });
  t.after(() => { projects.dispose(); services.dispose(); });
  return { services, projects, state, records, errors, workers };
}

function designer(current, applySourceEdits = async () => {}) {
  const provider = designerConfiguration({ state: current.state, designerDiagnostics: current.projects.diagnostics,
    explorerContext: () => ({ records: current.records }) });
  const view = { ...provider, document: new DesignDocument(), ensure() {}, toast() {},
    chrome: { setMode() {}, renderSync() {}, refreshSource() {} }, applySourceEdits,
    replace(value, { path }) { this.document = new DesignDocument(value); this.path = path; } };
  view.sourceSync = new DesignerSourceSync(view);
  view.safe = action => DesignerTools.prototype.safe.call(view, action);
  return view;
}

test('actual project loading publishes warnings into Error List without failing a build or leaking to project B', async t => {
  const current = fixture(t);
  const warnings = current.errors.rows();
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].source, 'project');
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].code, 'SFP1201');
  assert.equal(warnings[0].contextId, current.state.projectSystem.getContext('A/A.csproj').id);
  assert.equal(warnings[0].projectId, 'A/A.csproj');
  assert.equal(warnings[0].uri, 'A/A.csproj');
  assert.equal((await current.services.builds.get('A/A.csproj').build()).success, true);
  assert.equal(current.workers.workers[0].requests[0].method, 'build');
  await current.services.builds.get('B/B.csproj').build();
  assert.equal(current.errors.rows().length, 1);
  const revision = current.services.diagnostics.revision;
  current.projects.sync();
  assert.equal(current.services.diagnostics.revision, revision, 'unchanged loading diagnostics must not re-publish');
});

test('loader errors block only their project and appear once under their producer; reevaluation removes only obsolete entries', async t => {
  const current = fixture(t);
  const record = current.state.projectSystem.files.get('A/A.csproj');
  record.text = record.text.replace('</Project>', '<Import Project="missing.props"/></Project>');
  current.state.projectSnapshot = current.state.projectSystem.load('Apps.slnx');
  current.projects.sync();
  assert.equal((await current.services.builds.get('A/A.csproj').build()).success, false);
  assert.equal(current.workers.workers[0].requests.length, 0);
  assert.equal((await current.services.builds.get('B/B.csproj').build()).success, true);
  const loadingError = current.errors.rows().filter(item => item.code === 'SFP1202');
  assert.equal(loadingError.length, 1);
  assert.equal(loadingError[0].source, 'project');
  assert.equal(loadingError[0].contextId, current.state.projectSystem.getContext('A/A.csproj').id);
  current.services.diagnostics.replace('B/B.csproj', 'analysis', [{ message: 'B live warning', severity: 'warning' }]);
  record.text = record.text.replace('<Import Project="missing.props"/>', '');
  current.state.projectSnapshot = current.state.projectSystem.load('Apps.slnx');
  current.projects.sync();
  assert.equal(current.errors.rows().some(item => item.code === 'SFP1202'), false);
  assert.equal(current.errors.rows().some(item => item.message === 'B live warning'), true);
});

test('real designer source synchronization publishes protected-expression warnings and errors under the captured source owner', async t => {
  const current = fixture(t);
  const view = designer(current);
  t.after(() => view.sourceSync.dispose());
  await view.sourceSync.connect('A/View.cs');
  const warnings = current.errors.rows().filter(item => item.source === 'designer');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'SFSYNC_DYNAMIC');
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].projectId, 'A/A.csproj');
  assert.equal(warnings[0].uri, 'A/View.cs');
  assert(warnings[0].length > 0);
  current.state.active = 'B/View.cs';
  current.state.startupProject = 'B/B.csproj';
  view.document.setProperty('Width', 123, ['action']);
  await view.safe(() => view.sourceSync.write());
  const failure = current.errors.rows().find(item => item.source === 'designer' && item.severity === 'error');
  assert.equal(failure.projectId, 'A/A.csproj');
  assert.match(failure.message, /dynamic/);
  assert.equal(current.errors.rows().some(item => item.source === 'designer' && item.projectId === 'B/B.csproj'), false);
  view.sourceSync.disconnect();
  assert.equal(current.errors.rows().some(item => item.source === 'designer'), false);
});

test('source edits, project removal and disposal invalidate designer reports without erasing other producers', async t => {
  const current = fixture(t);
  let target = current.projects.diagnostics.capture('A/View.cs');
  current.projects.diagnostics.publish(target, [{ message: 'Original owner', severity: 'warning' }]);
  current.services.documents.setProjectMembership('B/B.csproj', ['A/View.cs', 'B/View.cs']);
  assert.equal(current.errors.rows().some(item => item.source === 'designer'), false);
  assert.equal(current.projects.diagnostics.publish(target, [{ message: 'Old membership' }]), false);
  target = current.projects.diagnostics.capture('A/View.cs');
  current.projects.diagnostics.publish(target, [{ message: 'Shared source', severity: 'warning' }]);
  assert.deepEqual(current.errors.rows().filter(item => item.source === 'designer').map(item => item.projectId),
    ['A/A.csproj', 'B/B.csproj']);
  current.services.documents.setProjectMembership('B/B.csproj', ['B/View.cs']);
  assert.equal(current.errors.rows().some(item => item.source === 'designer'), false);
  target = current.projects.diagnostics.capture('A/View.cs');
  current.projects.diagnostics.publish(target, [{ message: 'Staged design warning', severity: 'warning' }]);
  current.services.documents.update('A/View.cs', design + '\n');
  assert.equal(current.errors.rows().some(item => item.source === 'designer'), false);
  assert.equal(current.projects.diagnostics.publish(target, [{ message: 'Late failure', severity: 'error' }]), false);
  const other = current.projects.diagnostics.capture('B/View.cs');
  current.projects.diagnostics.publish(other, [{ message: 'B design warning', severity: 'warning' }]);
  current.state.projectSystem.files.get('Apps.slnx').text = '<Solution><Project Path="B/B.csproj"/></Solution>';
  current.state.projectSnapshot = current.state.projectSystem.load('Apps.slnx');
  current.projects.sync();
  assert.deepEqual(current.errors.rows().map(item => item.projectId), ['B/B.csproj']);
  current.projects.dispose();
  assert.equal(current.projects.diagnostics.publish(other, [{ message: 'Disposed report' }]), false);
});

test('an asynchronous designer failure cannot replace a new link or attribute the old failure to its new project', async t => {
  const current = fixture(t);
  const pending = deferred();
  const view = designer(current, () => pending.promise);
  t.after(() => view.sourceSync.dispose());
  await view.sourceSync.connect('A/View.cs');
  view.document.setProperty('Height', 70, ['action']);
  const write = view.safe(() => view.sourceSync.write());
  await view.sourceSync.connect('B/View.cs');
  pending.reject(new Error('Old A validation failed'));
  await write;
  assert.equal(view.sourceSync.state, 'synced');
  assert.equal(current.errors.rows().some(item => item.message === 'Old A validation failed'), false);
  assert.deepEqual(current.errors.rows().filter(item => item.source === 'designer').map(item => item.projectId), ['B/B.csproj']);
});

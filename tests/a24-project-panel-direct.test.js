import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSystem} from '@sharpforge/project-system';
import {renderProjectPanel} from '../apps/studio/tools/project-panel.js';

function element() {
  const controls = new Map(['#project-entry', '#startup-project', '#project-configuration'].map(id => [id, {}]));
  return {innerHTML: '', querySelector: id => controls.get(id)};
}

function fixture() {
  const system = new ProjectSystem([
    {path: 'App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework>' +
      '<OutputType>Exe</OutputType><Company>&lt;script&gt;</Company></PropertyGroup><ItemGroup>' +
      '<ProjectReference Include="Lib/Lib.csproj"/></ItemGroup></Project>'},
    {path: 'Program.cs', text: 'class Program { static void Main() {} }'},
    {path: 'Lib/Lib.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>' +
      '<TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'},
    {path: 'Lib/Library.cs', text: 'public class Library {}'},
    {path: 'Legacy.sln', text: 'Microsoft Visual Studio Solution File, Format Version 12.00'},
  ]);
  const snapshot = system.load('App.csproj');
  const state = {projectSystem: system, projectSnapshot: snapshot, startupProject: 'App.csproj', configuration: 'Debug',
    disk: {rootHandle: {}, handles: new Map()}, nativeMode: false};
  const calls = [];
  const context = {state, toast: (...args) => calls.push(['toast', ...args]),
    reloadDiskProject: async (...args) => calls.push(['reload', ...args]),
    setStartupProject: async path => calls.push(['startup', path])};
  return {state, system, snapshot, calls, context, view: element()};
}

test('Project renderer describes separate artifacts, retains legacy solution choices, and escapes evaluated source', () => {
  const app = fixture();
  const plan = app.system.buildPlan('App.csproj');
  assert.deepEqual(plan.units.map(unit => unit.project), ['Lib/Lib.csproj', 'App.csproj']);
  assert.equal(renderProjectPanel(app.view, app.context), true);
  assert.match(app.view.innerHTML, /separate assemblies in dependency order/);
  assert.match(app.view.innerHTML, /ProjectReference assembly metadata/);
  assert.match(app.view.innerHTML, /supported targets and tasks/);
  assert.match(app.view.innerHTML, /supported managed profile/);
  assert.match(app.view.innerHTML, /option value="Legacy.sln"/);
  assert.match(app.view.innerHTML, /Selected framework: <code>net10.0<\/code>/);
  assert.match(app.view.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(app.view.innerHTML, /<script>/);
  assert.match(app.view.innerHTML, /data-command="saveDisk">/);
  assert.deepEqual(app.calls, [], 'rendering must not compile, reload, or request permission');
});

test('Project choices preserve custom configurations and report synchronous or asynchronous host failures', async () => {
  const app = fixture();
  app.state.configuration = 'Shipping';
  renderProjectPanel(app.view, app.context);
  assert.match(app.view.innerHTML, /value="Shipping" selected/);
  await app.view.querySelector('#startup-project').onchange({target: {value: 'Lib/Lib.csproj'}});
  await app.view.querySelector('#project-entry').onchange({target: {value: 'Legacy.sln'}});
  await app.view.querySelector('#project-configuration').onchange({target: {value: 'Release'}});
  assert.deepEqual(app.calls, [['startup', 'Lib/Lib.csproj'], ['reload', 'Legacy.sln'], ['reload', 'App.csproj', {configuration: 'Release'}]]);
  assert.equal(app.state.configuration, 'Shipping', 'only a successful host model commit may publish the requested configuration');
  app.context.reloadDiskProject = () => { throw new Error('Entry unavailable'); };
  app.context.setStartupProject = async () => { throw new Error('Unsupported startup'); };
  renderProjectPanel(app.view, app.context);
  await app.view.querySelector('#project-entry').onchange({target: {value: 'missing.sln'}});
  await app.view.querySelector('#startup-project').onchange({target: {value: 'Unsupported.vcxproj'}});
  assert.deepEqual(app.calls.slice(-2), [['toast', 'Entry unavailable', 'error'], ['toast', 'Unsupported startup', 'error']]);
});

test('failed configuration evaluation retains the published model and restores the displayed choice', async () => {
  const app = fixture();
  let reject;
  app.context.reloadDiskProject = (path, options) => {
    app.calls.push(['reload', path, options]);
    return new Promise((resolve, fail) => { reject = fail; });
  };
  renderProjectPanel(app.view, app.context);
  const control = app.view.querySelector('#project-configuration');
  control.value = 'Release';
  const change = control.onchange({target: control});
  assert.equal(app.state.configuration, 'Debug');
  assert.equal(app.state.projectSnapshot, app.snapshot);
  reject(new Error('Project evaluation failed'));
  await change;
  assert.equal(app.state.configuration, 'Debug');
  assert.equal(app.state.projectSnapshot, app.snapshot);
  assert.equal(control.value, 'Debug');
  assert.deepEqual(app.calls, [['reload', 'App.csproj', {configuration: 'Release'}], ['toast', 'Project evaluation failed', 'error']]);
});

test('Retired Project controls cannot replace the current workspace or mutate its configuration', async () => {
  for (const change of ['system', 'snapshot', 'native']) {
    const app = fixture();
    renderProjectPanel(app.view, app.context);
    if (change === 'system') app.state.projectSystem = {};
    if (change === 'snapshot') app.state.projectSnapshot = {};
    if (change === 'native') app.state.nativeMode = true;
    await app.view.querySelector('#project-configuration').onchange({target: {value: 'Release'}});
    assert.equal(app.state.configuration, 'Debug');
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0][0], 'toast');
    assert.match(app.calls[0][1], /Workspace changed/);
  }
});

test('Read-only recovery and unsupported projects expose their limits without enabled save or build actions', () => {
  const app = fixture();
  app.state.disk = null;
  renderProjectPanel(app.view, app.context);
  assert.match(app.view.innerHTML, /data-command="saveDisk" disabled/);
  assert.match(app.view.innerHTML, /No disk handles are attached/);
  app.state.disk = {rootHandle: {}};
  app.state.recoveryReadOnly = true;
  renderProjectPanel(app.view, app.context);
  assert.match(app.view.innerHTML, /data-command="build" disabled/);
  assert.match(app.view.innerHTML, /Grant folder access before building or saving/);
  app.state.recoveryReadOnly = false;
  app.state.startupProject = 'Unsupported.vcxproj';
  const unloaded = {path: app.state.startupProject, name: 'Unsupported', unloaded: true};
  app.snapshot.projects.push(unloaded);
  app.system.projects.set(unloaded.path, unloaded);
  renderProjectPanel(app.view, app.context);
  assert.match(app.view.innerHTML, /value="Unsupported.vcxproj" selected disabled>Unsupported · unloaded/);
  assert.match(app.view.innerHTML, /data-command="build" disabled/);
  assert.match(app.view.innerHTML, /Project source text is not loaded/);
});

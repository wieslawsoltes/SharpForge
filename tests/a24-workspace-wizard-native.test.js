import test from 'node:test';
import assert from 'node:assert/strict';
import { getTemplate, templateAvailability } from '@sharpforge/templates';
import { commitWorkspaceWizard } from '../apps/studio/workspace-wizard.js';
import { NativeProjectContexts } from '../apps/studio/native-build/project-context.js';
import { NativeProjectProfiles } from '../apps/studio/native-build/profiles.js';
import { application } from './support/workspace-application.js';

const existingProject = 'Existing.csproj';
const newProject = 'Created/Created.csproj';
const plan = {
  template: 'console', name: 'Created', startup: newProject, openFile: 'Created/Program.cs', folders: ['Created'],
  records: [{ path: newProject, text: '<Project Sdk="Microsoft.NET.Sdk" />' },
    { path: 'Created/Program.cs', text: 'System.Console.WriteLine(42);' }]
};

function nativeApplication() {
  const app = application();
  const build = app.host.nativeBuild;
  const workspace = { root: '/native-fixture', projects: [existingProject], folders: [],
    files: [{ path: existingProject, text: '<Project Sdk="Microsoft.NET.Sdk" />' }] };
  Object.assign(app.state, { nativeMode: true, nativeWorkspace: workspace, nativeStartup: existingProject });
  Object.assign(build, { workspace, capabilities: { available: true, trusted: true, toolchains: { platform: 'win32' } },
    renderBuild() {}, request: () => ({ ...build.settings }) });
  Object.assign(build.settings, { project: existingProject, platform: 'AnyCPU', trusted: true });
  build.contexts = new NativeProjectContexts(build);
  build.contexts.reset(workspace);
  build.contexts.active = { id: 'previous-context', project: existingProject };
  build.contexts.contexts = [build.contexts.active];
  build.contexts.compilation = { files: [{ uri: 'Existing.cs', text: 'class Existing {}' }], references: [] };
  build.profiles = new NativeProjectProfiles(build);
  build.profiles.project = existingProject;
  build.profiles.launchProfile = 'Previous';
  const host = { ...app.host, actions: {}, open: () => app.events.push('open'), render: () => app.events.push('render'),
    save: () => app.events.push('save'), log: () => app.events.push('created') };
  return { ...app, host, build, options: { add: true, kind: 'project', context: host.context() } };
}

function selection(app) {
  return { startup: app.state.nativeStartup, request: app.build.settings.project,
    contexts: app.build.contexts.snapshot(), compilation: app.build.contexts.compilation,
    profiles: app.build.profiles.snapshot(), generation: app.build.contexts.generation };
}

test('native wizard availability uses the host operating system and does not infer it from build platform', () => {
  const app = nativeApplication();
  const template = getTemplate('winui-native-packaged');
  assert.equal(app.host.context().platform, 'win32');
  assert.equal(app.build.settings.platform, 'AnyCPU');
  assert.equal(templateAvailability(template, app.host.context()).available, true);
  app.build.capabilities.toolchains.platform = 'linux';
  assert.equal(templateAvailability(template, app.host.context()).available, false);
  delete app.build.capabilities.toolchains;
  assert.equal(app.host.context().platform, undefined);
  assert.equal(templateAvailability(template, app.host.context()).available, false);
  app.build.capabilities.toolchains = { platform: 'win32' };
  app.state.nativeMode = false;
  assert.equal(templateAvailability(template, app.host.context()).available, false);
});

test('native wizard selects the newly refreshed project for startup, evaluation and launch after a successful mutation', async () => {
  const app = nativeApplication();
  const before = selection(app);
  app.host.actions.perform = async operations => {
    assert.deepEqual(selection(app), before, 'selection stays unchanged while files are being created');
    assert(operations.some(operation => operation.path === newProject && operation.kind === 'create'));
    await Promise.resolve();
    app.build.workspace = { ...app.build.workspace, projects: [existingProject, newProject] };
    app.state.nativeWorkspace = app.build.workspace;
  };
  await commitWorkspaceWizard(app.host, plan, app.options);
  assert.equal(app.state.nativeStartup, newProject);
  assert.equal(app.build.settings.project, newProject);
  assert.equal(app.build.contexts.project, newProject);
  assert.equal(app.build.contexts.request().project, newProject);
  assert.equal(app.build.profiles.runRequest().project, newProject);
  assert.equal(app.build.contexts.active, null);
  assert.equal(app.build.contexts.compilation, null);
  assert.equal(app.build.profiles.launchProfile, '');
  assert.deepEqual(app.events, ['open', 'render', 'save', 'created']);
  assert.equal(app.host.actions.operationIdentity, null);
  assert.equal(app.host.actions.readSet, null);
});

test('a failed native wizard mutation preserves every startup selection and active compilation', async () => {
  const app = nativeApplication();
  const before = selection(app);
  app.host.actions.perform = async () => { throw new Error('Write transaction rejected'); };
  await assert.rejects(commitWorkspaceWizard(app.host, plan, app.options), /Write transaction rejected/);
  assert.deepEqual(selection(app), before);
  assert.deepEqual(app.events, []);
  assert.equal(app.host.actions.operationIdentity, null);
  assert.equal(app.host.actions.readSet, null);
});

test('a refreshed workspace that lacks the new startup project preserves the previous native selection', async () => {
  const app = nativeApplication();
  const before = selection(app);
  let performed = false;
  app.host.actions.perform = async () => { performed = true; };
  await assert.rejects(commitWorkspaceWizard(app.host, plan, app.options), /Select a project from the connected workspace/);
  assert.equal(performed, true, 'the failure concerns post-mutation selection, not a claim that file writes rolled back');
  assert.deepEqual(selection(app), before);
  assert.deepEqual(app.events, []);
  assert.equal(app.host.actions.operationIdentity, null);
  assert.equal(app.host.actions.readSet, null);
});

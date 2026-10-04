import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../apps/studio/commands/registry.js';
import { createMenuRegistry } from '../apps/studio/menus/registry.js';
import { registerStudioMenus } from '../apps/studio/menus/core.js';
import { ExplorerCommands } from '../apps/studio/explorer-commands.js';
import { menuCommands, workbenchMenus } from '../apps/studio/workbench/menus.js';
import { registerStartupCommands } from '../apps/studio/workbench/startup-commands.js';
import { StartupConfiguration } from '../apps/studio/workbench/startup-config.js';
import { LaunchProfiles } from '../apps/studio/workbench/launch-profiles.js';

const firstProject = 'Alpha/Alpha.csproj';
const secondProject = 'Beta/Beta.csproj';
const libraryProject = 'Shared/Shared.csproj';

function fixture(t, { hostStart = true, beforeRegister } = {}) {
  const projects = [
    { id: firstProject, outputType: 'exe' },
    { id: secondProject, outputType: 'exe' },
    { id: libraryProject, outputType: 'library' }
  ];
  const startup = new StartupConfiguration({ getProjects: () => projects });
  startup.configure({ mode: 'multiple', entries: [
    { projectId: firstProject, action: 'start' },
    { projectId: secondProject, action: 'startWithoutDebugging', profile: 'private' }
  ] });
  const profiles = new LaunchProfiles();
  profiles.set(secondProject, { id: 'private', arguments: ['beta'] });
  const calls = { configured: 0, profiles: 0, processes: 0, starts: [], stopped: 0 };
  const state = { nativeMode: false, hotEdit: false };
  const running = [];
  const operations = new Map();
  const start = projectId => {
    calls.starts.push(projectId);
    return { projectId, profile: profiles.get(projectId).id };
  };
  const stop = () => {
    calls.stopped++;
    for (const session of running) session.live = false;
    operations.clear();
  };
  const services = {
    startup, profiles, builds: { activeId: firstProject },
    sessions: {
      get active() { return running[0] ?? null; },
      list: ({ liveOnly = false } = {}) => running.filter(session => !liveOnly || session.live),
      stopAll: stop
    },
    launches: { operations, startNewInstance: start }
  };
  const registry = createCommandRegistry({ context: () => ({ projectId: services.builds.activeId }) });
  beforeRegister?.(registry);
  const unregister = registerStartupCommands(registry, {
    services, state: () => state, configure: () => calls.configured++, configureProfiles: () => calls.profiles++,
    showProcesses: () => calls.processes++, stopAll: stop, startNewInstance: hostStart ? start : undefined
  });
  let registered = true;
  const remove = () => {
    if (!registered) return;
    registered = false;
    unregister();
  };
  t.after(() => { remove(); registry.dispose(); startup.dispose(); profiles.dispose(); });
  return { services, registry, state, projects, running, calls, remove };
}

function explorerFixture(t, setup) {
  const context = { identity: 'startup-menu-workspace', readOnly: false, native: false, solutionPath: 'Demo.slnx' };
  const routed = [];
  const commands = new ExplorerCommands({
    context: () => context,
    projectCommandState: (id, node) => setup.registry.describe(id, { projectId: node.project ?? node.path }),
    project: (id, node) => {
      routed.push({ id, node });
      return setup.registry.invoke(id, { projectId: node.project ?? node.path });
    },
    error: error => { throw error; }
  });
  t.after(() => commands.dispose());
  return { context, commands, routed };
}

test('both main menu surfaces expose startup configuration, a new instance, and Stop All', t => {
  const { registry } = fixture(t);
  const legacy = createMenuRegistry();
  t.after(() => legacy.dispose());
  registerStudioMenus(legacy, { toolDefinitions: [{ id: 'output', title: 'Output' }] });
  const legacyIds = id => legacy.items(id).filter(Array.isArray).map(item => item[1]);
  const currentIds = id => menuCommands(workbenchMenus.find(menu => menu.id === id), registry).map(command => command.id);

  for (const ids of [legacyIds, currentIds]) {
    assert(ids('project').includes('solutionSetStartupProjects'));
    assert(ids('debug').includes('start-new-instance'));
    assert(ids('debug').includes('stop-all'));
  }
  assert(legacyIds('debug').includes('debug'));
  assert(legacyIds('debug').includes('run'));
  assert(legacyIds('debug').includes('stop'));
  assert(legacyIds('debug').includes('immediate'));
  assert(legacyIds('build').includes('nativeMSBuild'));
  assert(legacyIds('window').includes('tool:output'));
  assert(legacyIds('tools').includes('settings'));
});

test('configuration aliases and auxiliary session commands reuse their registered host actions', async t => {
  const { registry, calls, services } = fixture(t);
  const previous = services.startup.snapshot();
  await registry.execute('startup-projects');
  await registry.execute('solutionSetStartupProjects');
  await registry.execute('launch-profiles');
  await registry.execute('processes');
  assert.equal(calls.configured, 2);
  assert.equal(calls.profiles, 1);
  assert.equal(calls.processes, 1);
  assert.deepEqual(services.startup.snapshot(), previous);
});

test('explicit project invocation overrides ambient selection without changing startup or launch profiles', async t => {
  const { registry, calls, services, running } = fixture(t);
  const startup = services.startup.snapshot();
  const profiles = services.profiles.export();
  running.push({ id: 'alpha-session', projectId: firstProject, live: true, launchBusy: false });

  assert.equal(registry.describe('projectDebugStartNewInstance', { projectId: secondProject }).enabled, true);
  const explicit = await registry.invoke('projectDebugStartNewInstance', { projectId: secondProject });
  const argument = await registry.execute('start-new-instance', { projectId: secondProject });
  await registry.execute('projectDebugStartNewInstance', secondProject);
  await registry.execute('start-new-instance');

  assert.deepEqual(explicit, { projectId: secondProject, profile: 'private' });
  assert.deepEqual(argument, explicit);
  assert.deepEqual(calls.starts, [secondProject, secondProject, secondProject, firstProject]);
  assert.equal(services.builds.activeId, firstProject);
  assert.equal(running[0].id, 'alpha-session');
  assert.equal(running[0].live, true);
  assert.deepEqual(services.startup.snapshot(), startup);
  assert.deepEqual(services.profiles.export(), profiles);
});

test('a host without an execution override still launches the explicit project using its selected profile', async t => {
  const { registry, calls, services } = fixture(t, { hostStart: false });
  const previous = services.startup.snapshot();
  assert.deepEqual(await registry.invoke('projectDebugStartNewInstance', { projectId: secondProject }), {
    projectId: secondProject, profile: 'private'
  });
  assert.deepEqual(calls.starts, [secondProject]);
  assert.deepEqual(services.startup.snapshot(), previous);
});

test('library, missing and empty targets cannot silently fall back to the startup project', async t => {
  const { registry, calls } = fixture(t);
  for (const [projectId, expected] of [
    [libraryProject, /Library project .* cannot be started/],
    ['Missing.csproj', /Unknown startup project/],
    ['', /Open a project/]
  ]) {
    for (const id of ['start-new-instance', 'projectDebugStartNewInstance']) {
      const command = registry.describe(id, { projectId });
      assert.equal(command.enabled, false);
      assert.match(command.disabledReason, expected);
      await assert.rejects(registry.invoke(id, { projectId }), expected);
    }
  }
  assert.deepEqual(calls.starts, []);
});

test('new-instance availability refreshes native, Hot Reload and pending-launch explanations', async t => {
  const { registry, state, services, calls } = fixture(t);
  state.nativeMode = true;
  assert.match(registry.describe('start-new-instance').disabledReason, /Native process attachment is unavailable/);
  await assert.rejects(registry.execute('projectDebugStartNewInstance'), /Inspect IL/);
  state.nativeMode = false;
  state.hotEdit = true;
  await assert.rejects(registry.execute('start-new-instance'), /Apply or cancel Hot Reload/);
  state.hotEdit = false;
  services.launches.operations.set('pending', {});
  assert.match(registry.describe('projectDebugStartNewInstance').disabledReason, /current launch/);
  await assert.rejects(registry.execute('start-new-instance'), /current launch/);
  services.launches.operations.clear();
  assert.equal(registry.describe('start-new-instance').enabled, true);
  assert.deepEqual(calls.starts, []);
});

test('Stop All is enabled for live sessions or pending launches and uses the host cancellation path', async t => {
  const { registry, running, services, calls } = fixture(t);
  running.push({ id: 'ended', live: false });
  assert.equal(registry.describe('stop-all').enabled, false);
  await assert.rejects(registry.execute('stop-all'), /No applications or launches/);
  services.launches.operations.set('building', {});
  assert.equal(registry.describe('stop-all').enabled, true);
  await registry.execute('stop-all');
  assert.equal(services.launches.operations.size, 0);
  running.push({ id: 'beta-session', live: true });
  await registry.execute('stop-all');
  assert.equal(running[1].live, false);
  assert.equal(calls.stopped, 2);
  assert.equal(registry.describe('stop-all').enabled, false);
});

test('startup configuration is disabled when no projects remain', async t => {
  const { registry, projects, calls } = fixture(t);
  projects.length = 0;
  for (const id of ['startup-projects', 'solutionSetStartupProjects', 'launch-profiles']) {
    assert.equal(registry.describe(id).enabled, false);
    await assert.rejects(registry.execute(id), /Open a project/);
  }
  assert.equal(calls.configured, 0);
  assert.equal(calls.profiles, 0);
});

test('Explorer solution and project menus route the exact selected node through the public aliases', async t => {
  const setup = fixture(t);
  const { commands, context, routed } = explorerFixture(t, setup);
  const solution = { kind: 'solution', path: 'Demo.slnx' };
  const project = { kind: 'project', project: secondProject, path: secondProject };
  const startup = setup.services.startup.snapshot();
  context.readOnly = true;
  const solutionMenu = commands.menu(solution);
  await solutionMenu.find(item => item?.label === 'Set Startup Projects…').action();
  const projectMenu = commands.menu(project);
  assert.match(projectMenu.find(item => item?.label === 'Set as Startup Project').enabled(), /Stop debugging/);
  const debug = projectMenu.find(item => item?.label === 'Debug');
  assert.equal(debug.enabled(), true);
  assert.equal(debug.children[0].label, 'Start New Instance');
  await debug.children[0].action();

  assert.deepEqual(routed, [
    { id: 'solutionSetStartupProjects', node: solution },
    { id: 'projectDebugStartNewInstance', node: project }
  ]);
  assert.equal(setup.calls.configured, 1);
  assert.deepEqual(setup.calls.starts, [secondProject]);
  assert.deepEqual(setup.services.startup.snapshot(), startup);
  assert.equal(setup.services.builds.activeId, firstProject);
  assert.equal(commands.runningMutation, undefined);
  assert.equal(commands.menu({ kind: 'file', path: 'notes.txt' }).some(item => item?.label === 'Debug'), false);
});

test('Explorer uses current registry reasons and preserves native build, restore and evaluate availability', t => {
  const setup = fixture(t);
  const { commands, context } = explorerFixture(t, setup);
  const project = { kind: 'project', project: libraryProject, path: libraryProject };
  const library = commands.menu(project).find(item => item?.label === 'Debug');
  assert.match(library.enabled(), /Library project/);
  assert.equal(library.enabled(), setup.registry.describe('projectDebugStartNewInstance', { projectId: libraryProject }).disabledReason);

  setup.state.nativeMode = true;
  context.native = true;
  const menu = commands.menu(project);
  for (const label of ['Build', 'Rebuild', 'Clean', 'Restore Packages', 'Evaluate Project']) {
    assert.match(menu.find(item => item?.label === label).enabled(), /Connect an available MSBuild engine/);
  }
  assert.match(menu.find(item => item?.label === 'Debug').enabled(), /Native process attachment is unavailable/);
  context.nativeAvailable = true;
  context.trusted = true;
  assert.equal(menu.find(item => item?.label === 'Build').enabled(), true);
  context.buildBusy = true;
  assert.match(menu.find(item => item?.label === 'Build').enabled(), /Connect an available MSBuild engine/);
});

test('aborted invocations do not start and disposal restores a previously registered command', async t => {
  const { registry, calls, remove } = fixture(t, {
    beforeRegister: commands => commands.registerCommand('start-new-instance', 'Previous Start', '', () => 'previous')
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(registry.invoke('projectDebugStartNewInstance', {
    projectId: secondProject, signal: controller.signal
  }), { name: 'AbortError' });
  assert.deepEqual(calls.starts, []);
  remove();
  assert.equal(registry.describe('projectDebugStartNewInstance'), null);
  assert.equal(registry.describe('solutionSetStartupProjects'), null);
  assert.equal(registry.describe('stop-all'), null);
  assert.equal(registry.describe('start-new-instance').label, 'Previous Start');
  assert.equal(await registry.execute('start-new-instance'), 'previous');
});

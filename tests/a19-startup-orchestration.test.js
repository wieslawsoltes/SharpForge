import test from 'node:test';
import assert from 'node:assert/strict';
import { StartupConfiguration } from '../apps/studio/workbench/startup-config.js';
import { LaunchProfiles } from '../apps/studio/workbench/launch-profiles.js';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { CommandRegistry } from '../packages/controls/src/index.js';
import { registerSessionCommands } from '../apps/studio/workbench/session-commands.js';
import { projectDecoration } from '../apps/studio/workbench/build-decorations.js';
import { fakeWorkers, fakeRuntime, compileResult } from './a19-session-fixtures.js';

const projects = [
  { id: 'Common', outputType: 'library', files: [] },
  { id: 'A', name: 'Alpha', outputType: 'exe', dependencies: ['Common'], files: [] },
  { id: 'B', name: 'Beta', outputType: 'exe', files: [] }
];

test('startup modes validate libraries/unknown projects and serialize in deterministic order', () => {
  const startup = new StartupConfiguration({ getProjects: () => projects });
  startup.configure({ mode: 'multiple', entries: [
    { projectId: 'B', action: 'Start without debugging', order: 4 },
    { projectId: 'A', action: 'Start', order: 1 }
  ] });
  assert.deepEqual(startup.resolve().map(entry => [entry.projectId, entry.debug]), [['A', true], ['B', false]]);
  const serialized = startup.serialize();
  startup.restore(serialized);
  assert.equal(startup.serialize(), serialized);
  assert.throws(() => startup.select('Common'), { code: 'STARTUP_LIBRARY' });
  assert.throws(() => startup.select('Missing'), { code: 'STARTUP_PROJECT_MISSING' });
  assert.throws(() => startup.configure({ entries: [{ projectId: 'A' }, { projectId: 'A' }] }));
  startup.configure({ mode: 'currentSelection' });
  assert.equal(startup.resolve({ currentProjectId: 'B' })[0].projectId, 'B');
  startup.dispose();
});

test('profiles isolate project settings, return copies and exclude grants/environment from exported preferences', () => {
  const profiles = new LaunchProfiles();
  profiles.set('A', { id: 'network', arguments: ['one'], environment: { SECRET_TOKEN: 'private-value' }, runtimeSettings: {
    enabled: true, allowedOrigins: ['https://api.example.com']
  } });
  profiles.select('A', 'network');
  const value = profiles.get('A');
  value.arguments.push('mutated');
  value.runtimeSettings.allowedOrigins.push('https://other.example.com');
  assert.deepEqual(profiles.get('A').arguments, ['one']);
  assert.deepEqual(profiles.launchOptions('A').network.allowedOrigins, ['https://api.example.com']);
  assert.deepEqual(profiles.launchOptions('B').network.allowedOrigins, []);
  const serialized = JSON.stringify(profiles.export());
  assert.equal(serialized.includes('private-value'), false);
  assert.equal(serialized.includes('api.example.com'), false);
  assert.throws(() => profiles.set('B', { id: 'bad', renderer: 'unsupported' }));
  profiles.dispose();
});

test('startup builds dependencies once, preserves configured order and starts independent roots after one failure', async () => {
  const trace = [];
  const fake = fakeWorkers((message, worker) => {
    if (message.method === 'build') {
      const project = worker.options.name.slice('compiler:'.length);
      trace.push(`build:${project}`);
      return compileResult(project !== 'B');
    }
    if (message.method === 'launch') trace.push(`launch:${worker.options.name}`);
    return fakeRuntime(message, worker);
  });
  const workbench = createWorkbenchServices({ workerFactory: fake.factory, projects });
  workbench.startup.configure({ mode: 'multiple', entries: [{ projectId: 'B' }, { projectId: 'A' }] });
  const result = await workbench.launches.start();
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].projectId, 'B');
  assert.equal(result.started.length, 1);
  assert.equal(workbench.sessions.get(result.started[0]).projectId, 'A');
  assert.deepEqual(trace.slice(0, 3), ['build:B', 'build:Common', 'build:A']);
  assert.equal(workbench.diagnostics.query({ projectId: 'B' }).length, 1);
  assert.equal(workbench.diagnostics.query({ projectId: 'A' }).length, 0);
  workbench.dispose();
});

test('two successful startup roots keep independent session resources and restart commands use explicit context', async () => {
  const fake = fakeWorkers((message, worker) => message.method === 'build' ? compileResult() : fakeRuntime(message, worker));
  const workbench = createWorkbenchServices({ workerFactory: fake.factory, projects });
  workbench.startup.configure({ mode: 'multiple', entries: [{ projectId: 'A' }, { projectId: 'B', action: 'startWithoutDebugging' }] });
  const result = await workbench.launches.start();
  assert.equal(result.started.length, 2);
  const [a, b] = result.started.map(id => workbench.sessions.get(id));
  assert.equal(a.debugging, true);
  assert.equal(b.debugging, false);
  const registry = new CommandRegistry();
  const unregister = registerSessionCommands(registry, workbench);
  const bIdentity = b.identity;
  await registry.execute('debug.restartSession', { sessionId: a.id });
  assert.equal(b.identity, bIdentity);
  assert.equal(b.state, 'running');
  await registry.execute('debug.stopSession', { sessionId: a.id });
  assert.equal(b.state, 'running');
  const decoration = projectDecoration('B', workbench);
  assert.equal(decoration.running, 1);
  assert.equal(decoration.startup, true);
  assert.match(decoration.accessibleName, /1 running/);
  unregister();
  workbench.dispose();
});

test('workbench disposal terminates every owned worker without closing another workbench', async () => {
  const fake = fakeWorkers((message, worker) => message.method === 'build' ? compileResult() : fakeRuntime(message, worker));
  const first = createWorkbenchServices({ workerFactory: fake.factory, projects: [projects[2]] });
  const second = createWorkbenchServices({ workerFactory: fake.factory, projects: [projects[2]] });
  first.startup.select('B');
  second.startup.select('B');
  await first.launches.start();
  await second.launches.start();
  const otherRuntime = second.sessions.active.worker.worker;
  first.dispose();
  assert.equal(otherRuntime.terminated, false);
  assert.equal(second.sessions.active.state, 'running');
  second.dispose();
  assert.equal(fake.workers.every(worker => worker.terminated), true);
});

test('default build snapshots use current shared document revisions without changing source descriptors', async () => {
  const record = { uri: 'A.cs', text: 'before', version: 1 };
  const fake = fakeWorkers(message => message.method === 'build' ? compileResult() : { ok: true });
  const workbench = createWorkbenchServices({ workerFactory: fake.factory, records: [record], projects: [{ id: 'A', files: [record] }] });
  workbench.documents.update('A.cs', 'after');
  await workbench.builds.get('A').build();
  assert.equal(fake.workers[0].requests[0].params.files[0].text, 'after');
  assert.equal(fake.workers[0].requests[0].params.files[0].version, 2);
  assert.equal(record.text, 'before');
  workbench.dispose();
});

test('source and managed IL profiles forward program argv separately from method parameters', async () => {
  const fake = fakeWorkers((message, worker) => message.method === 'build' ? compileResult() : fakeRuntime(message, worker));
  const workbench = createWorkbenchServices({ workerFactory: fake.factory, projects: [projects[2]] });
  workbench.profiles.set('B', { id: 'args', arguments: ['one'] });
  for (const managedIL of [false, true]) {
    const result = await workbench.launches.startNewInstance('B', { profile: 'args', managedIL });
    assert.equal(result.started.length, 1);
    const launch = workbench.sessions.get(result.started[0]).lastLaunch;
    assert.deepEqual(launch.programArguments, ['one']);
    assert.equal(launch.arguments, undefined);
  }
  workbench.profiles.set('B', { id: 'env', environment: { TEST_VALUE: 'one' } });
  const environment = await workbench.launches.startNewInstance('B', { profile: 'env', managedIL: true });
  assert.equal(environment.started.length, 1);
  assert.deepEqual(workbench.sessions.get(environment.started[0]).lastLaunch.environment, { TEST_VALUE: 'one' });
  workbench.dispose();
});

test('an explicitly restricted external launch target refuses unsupported profile capabilities', async () => {
  const fake = fakeWorkers((message, worker) => message.method === 'build' ? compileResult() : fakeRuntime(message, worker));
  const workbench = createWorkbenchServices({
    workerFactory: fake.factory, projects: [projects[2]], launchCapabilities: () => ({ arguments: false, environment: false })
  });
  workbench.profiles.set('B', { id: 'args', arguments: ['one'] });
  workbench.profiles.set('B', { id: 'env', environment: { TEST_VALUE: 'one' } });
  for (const profile of ['args', 'env']) {
    const result = await workbench.launches.startNewInstance('B', { profile, managedIL: true });
    assert.equal(result.failed[0].error.code, 'LAUNCH_CAPABILITY');
    assert.equal(workbench.sessions.list().length, 0);
  }
  workbench.dispose();
});

test('concurrent starts queue one shared project build and keep independent application instances', async () => {
  let buildCount = 0;
  const fake = fakeWorkers((message, worker) => {
    if (message.method !== 'build') return fakeRuntime(message, worker);
    buildCount++;
    return compileResult();
  });
  const workbench = createWorkbenchServices({ workerFactory: fake.factory, projects: [projects[2]] });
  const results = await Promise.all([workbench.launches.startNewInstance('B'), workbench.launches.startNewInstance('B')]);
  assert.equal(buildCount, 1);
  assert.equal(results.every(result => result.started.length === 1 && result.failed.length === 0), true);
  assert.notEqual(results[0].started[0], results[1].started[0]);
  workbench.dispose();
});

test('failed startup preference storage leaves the previous configuration intact', () => {
  let refuse = false;
  const startup = new StartupConfiguration({ getProjects: () => projects, save: () => { if (refuse) throw new Error('storage failed'); } });
  startup.select('A');
  const previous = startup.serialize();
  refuse = true;
  assert.throws(() => startup.select('B'), /storage failed/);
  assert.equal(startup.serialize(), previous);
  startup.dispose();
});

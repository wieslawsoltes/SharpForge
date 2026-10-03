import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { createRuntimeToolsBridge } from '../apps/studio/workbench/session-runtime-bridge.js';
import { RuntimeTools } from '../apps/studio/runtime-tools.js';
import { compileResult, fakeRuntime, fakeWorkers, deferred, settle } from './a19-session-fixtures.js';

function fixture(respond) {
  const fake = fakeWorkers((message, worker) => respond?.(message, worker)
    ?? (message.method === 'build' ? compileResult() : fakeRuntime(message, worker)));
  const services = createWorkbenchServices({ workerFactory: fake.factory, projects: [
    { id: 'A.csproj', name: 'Alpha', outputType: 'exe', files: [] },
    { id: 'B.csproj', name: 'Beta', outputType: 'exe', files: [] },
    { id: '$workspace', name: 'Loose source', outputType: 'exe', files: [] }
  ] });
  services.profiles.set('A.csproj', { id: 'alpha', arguments: ['private-alpha'], environment: { APP: 'alpha' },
    runtimeSettings: { enabled: true, allowedOrigins: ['https://alpha.example'], compute: { backend: 'scalar', workers: 3 } } });
  services.profiles.set('B.csproj', { id: 'beta', runtimeSettings: { compute: { workers: 1 } } });
  const state = { langVersion: '14', revision: 0 };
  let projectId = 'A.csproj';
  let saves = 0;
  const bridge = createRuntimeToolsBridge({ services, state: () => state, getProjectId: () => projectId, save: () => saves++ });
  return { services, state, bridge, fake, get saves() { return saves; }, setProject(id) { projectId = id; } };
}

async function launchPair(services) {
  services.startup.configure({ mode: 'multiple', entries: [
    { projectId: 'A.csproj', profile: 'alpha' }, { projectId: 'B.csproj', profile: 'beta' }
  ] });
  const result = await services.launches.start();
  assert.equal(result.failed.length, 0);
  return result.started.map(id => services.sessions.get(id));
}

test('injected RuntimeTools keeps existing profile grants and target launches do not inherit the active app settings', async () => {
  const { services, bridge } = fixture();
  const tool = new RuntimeTools({ state: bridge.state, settings: bridge, request: (...args) => bridge.request(...args),
    build: () => bridge.build(), toast: () => {} });
  assert.deepEqual(tool.settings().allowedOrigins, ['https://alpha.example']);
  const [alpha, beta] = await launchPair(services);
  services.sessions.setActive(alpha.id);
  assert.deepEqual(alpha.activeRuntimeSettings.network.allowedOrigins, ['https://alpha.example']);
  assert.deepEqual(beta.activeRuntimeSettings.network.allowedOrigins, []);
  assert.equal(alpha.profileId, 'alpha');
  assert.equal(beta.profileId, 'beta');
  bridge.select({ sessionId: alpha.id });
  const explicit = tool.launchOptions({ projectId: 'B.csproj' });
  assert.deepEqual(explicit.network.allowedOrigins, []);
  assert.equal(explicit.compute.workers, 1);
  assert.equal('programArguments' in explicit, false);
  assert.equal('arguments' in explicit, false);
  assert.equal('environment' in explicit, false);
  services.dispose();
});

test('profile settings apply to the next project launch only without rebuilding or mutating existing apps', async () => {
  const value = fixture();
  const { services, bridge, fake, state } = value;
  const [alpha, beta] = await launchPair(services);
  services.sessions.setActive(beta.id);
  const before = fake.workers.flatMap(worker => worker.requests).filter(request => request.method === 'build').length;
  bridge.configure({ allowedOrigins: ['https://next-alpha.example'], compute: { workers: 4 } });
  assert.equal(value.saves, 1);
  assert.equal(state.revision, 0);
  assert.deepEqual(await bridge.build(), { skipped: true, reason: 'execution-settings-only' });
  assert.equal(fake.workers.flatMap(worker => worker.requests).filter(request => request.method === 'build').length, before);
  assert.deepEqual(alpha.activeRuntimeSettings.network.allowedOrigins, ['https://alpha.example']);
  assert.deepEqual(services.settings.get(alpha.id).allowedOrigins, ['https://alpha.example']);
  assert.deepEqual(services.settings.get(beta.id).allowedOrigins, []);
  const launched = await services.launches.startNewInstance('A.csproj');
  const next = services.sessions.get(launched.started[0]);
  assert.equal(next.profileId, 'alpha');
  assert.deepEqual(next.activeRuntimeSettings.network.allowedOrigins, ['https://next-alpha.example']);
  assert.deepEqual(next.lastLaunch.programArguments, ['private-alpha']);
  assert.equal(next.lastLaunch.environment.APP, 'alpha');
  services.dispose();
});

test('session settings remain scoped through active-app switches and only take effect on that app restart', async () => {
  const { services, bridge } = fixture();
  const [alpha, beta] = await launchPair(services);
  bridge.select({ sessionId: alpha.id });
  services.sessions.setActive(beta.id);
  const betaIdentity = beta.identity;
  bridge.configure({ enabled: true, allowedOrigins: ['https://session-alpha.example'], compute: { workers: 6 } });
  assert.equal(services.sessions.activeId, beta.id);
  assert.deepEqual(alpha.activeRuntimeSettings.network.allowedOrigins, ['https://alpha.example']);
  assert.deepEqual(services.profiles.get('A.csproj').runtimeSettings.allowedOrigins, ['https://alpha.example']);
  assert.deepEqual(services.settings.get(beta.id).allowedOrigins, []);
  await alpha.restart();
  assert.deepEqual(alpha.activeRuntimeSettings.network.allowedOrigins, ['https://session-alpha.example']);
  assert.equal(beta.identity, betaIdentity);
  assert.equal(beta.state, 'running');
  assert.equal(bridge.state.debug.appId, alpha.id);
  assert.deepEqual(Object.keys(bridge.state), ['runtimeSettings', 'langVersion', 'projectSystem', 'readOnly', 'debug']);
  services.dispose();
});

test('profile and session revocation stop only the explicitly associated applications', async () => {
  const { services, bridge } = fixture();
  const [alpha, beta] = await launchPair(services);
  const again = await services.launches.startNewInstance('A.csproj');
  const secondAlpha = services.sessions.get(again.started[0]);
  bridge.select({ sessionId: alpha.id });
  await bridge.revokeAndStop();
  assert.equal(alpha.live, false);
  assert.equal(secondAlpha.state, 'running');
  assert.equal(beta.state, 'running');
  bridge.select({ projectId: 'A.csproj', profileId: 'alpha' });
  await bridge.revokeAndStop();
  assert.equal(secondAlpha.live, false);
  assert.equal(beta.state, 'running');
  assert.equal(services.profiles.get('A.csproj').runtimeSettings.enabled, false);
  assert.deepEqual(services.settings.get(secondAlpha.id).allowedOrigins, []);
  services.dispose();
});

test('settings requests capture the chosen app and do not fall back to a foreign active session', async () => {
  const pending = deferred();
  const { services, bridge } = fixture(message => message.method === 'runtimeInfo' ? pending.promise : undefined);
  const [alpha, beta] = await launchPair(services);
  bridge.select({ sessionId: alpha.id });
  const request = bridge.request('runtimeInfo');
  bridge.select({ sessionId: beta.id });
  pending.resolve({ owner: alpha.id });
  assert.deepEqual(await request, { owner: alpha.id });
  assert.equal(alpha.worker.worker.requests.at(-1).method, 'runtimeInfo');
  assert.equal(beta.worker.worker.requests.some(message => message.method === 'runtimeInfo'), false);
  bridge.select({ projectId: '$workspace' });
  await assert.rejects(bridge.request('runtimeInfo'), { code: 'RUNTIME_SETTINGS_SESSION' });
  services.dispose();
});

test('late metrics cannot repaint a newly selected settings target', async () => {
  const pending = deferred();
  const { services, bridge } = fixture(message => message.method === 'runtimeInfo' ? pending.promise : undefined);
  const [alpha, beta] = await launchPair(services);
  bridge.select({ sessionId: alpha.id });
  const metric = { textContent: 'beta metrics' };
  const tool = new RuntimeTools({ state: bridge.state, settings: bridge, request: (...args) => bridge.request(...args), toast: () => {} });
  tool.el = { querySelector: () => metric };
  const refresh = tool.refresh();
  await settle();
  bridge.select({ sessionId: beta.id });
  pending.resolve({ owner: alpha.id });
  await refresh;
  assert.equal(metric.textContent, 'beta metrics');
  services.dispose();
});

test('target selector values are stable and invalid settings do not change any target', () => {
  const { services, bridge } = fixture();
  const before = bridge.settings();
  const target = bridge.targets().find(item => item.kind === 'profile');
  bridge.select(target.id);
  assert.equal(bridge.context().profileId, 'alpha');
  for (const patch of [{ enabled: 'yes' }, { allowedOrigins: ['https://example.com/path'] }, { compute: { workers: 9 } }, { langVersion: '13' }]) {
    assert.throws(() => bridge.configure(patch));
    assert.deepEqual(bridge.settings(), before);
  }
  assert.throws(() => bridge.select({ projectId: 'missing' }), { code: 'RUNTIME_SETTINGS_PROJECT' });
  assert.throws(() => bridge.select({ sessionId: 'missing' }), { code: 'SESSION_MISSING' });
  services.dispose();
});

test('only an actual loose-source language change schedules its project compilation', async () => {
  const value = fixture();
  value.setProject('$workspace');
  value.bridge.configure({ langVersion: '13' });
  assert.equal(value.state.langVersion, '13');
  assert.equal(value.state.revision, 1);
  assert.equal((await value.bridge.build()).success, true);
  const builds = value.fake.workers.filter(worker => worker.requests.some(request => request.method === 'build'));
  assert.deepEqual(builds.map(worker => worker.options.name), ['compiler:$workspace']);
  assert.equal((await value.bridge.build()).skipped, true);
  value.services.dispose();
});

test('legacy hosts retain the RuntimeTools API with explicitly isolated default settings', () => {
  const state = { runtimeSettings: { enabled: true }, langVersion: '14', revision: 0 };
  const tool = new RuntimeTools({ state, save: () => {}, toast: () => {} });
  assert.equal(tool.settings().enabled, false);
  tool.configure({ enabled: true, allowedOrigins: ['https://example.com'], compute: { workers: 3 } });
  assert.deepEqual(tool.launchOptions().network.allowedOrigins, ['https://example.com']);
  assert.equal(state.revision, 1);
  assert.equal(state.buildDirty, true);
  tool.revoke();
  assert.deepEqual(tool.launchOptions().network.allowedOrigins, []);
});

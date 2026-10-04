import test from 'node:test';
import assert from 'node:assert/strict';
import { exportWorkspaceZip, importWorkspaceZip, importWorkspaceRecords, workspaceManifestRecord,
  sanitizeSessionUserSettings, sessionUserSettingsLimits, sessionUserSettingsContributions } from '@sharpforge/project-system';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { SessionRecovery } from '../apps/studio/workbench/session-recovery.js';
import { fakeWorkers } from './a19-session-fixtures.js';

const projects = [
  { id: 'Alpha/Alpha.csproj', name: 'Alpha', outputType: 'exe', files: [] },
  { id: 'Beta/Beta.csproj', name: 'Beta', outputType: 'exe', files: [] },
  { id: 'Shared/Shared.csproj', outputType: 'library', files: [] }
];
const alpha = projects[0].id;
const beta = projects[1].id;

function workbench() {
  return createWorkbenchServices({ projects, workerFactory: fakeWorkers().factory });
}

function configure(services) {
  services.profiles.set(alpha, { id: 'frontend', name: 'Frontend', arguments: ['private-argument'],
    environment: { PRIVATE: 'private-environment' }, renderer: 'dom', stopOnEntry: true,
    runtimeSettings: { enabled: true, allowedOrigins: ['https://private.example'], compute: { backend: 'scalar', workers: 3 } } });
  services.profiles.set(beta, { id: 'backend', name: 'Backend', renderer: 'canvas2d' });
  services.startup.configure({ mode: 'multiple', entries: [
    { projectId: beta, profile: 'backend', action: 'startWithoutDebugging', order: 2 },
    { projectId: alpha, profile: 'frontend', action: 'start', order: 1 }
  ] });
}

test('session recovery exports only deterministic startup and non-executable profile metadata', () => {
  const services = workbench();
  configure(services);
  const recovery = new SessionRecovery(services);
  const payload = recovery.export();
  const serialized = JSON.stringify(payload);
  for (const secret of ['private-argument', 'private-environment', 'private.example', 'allowedOrigins', 'environment', 'arguments']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.deepEqual(payload.startupConfiguration.entries.map(entry => entry.projectId), [alpha, beta]);
  assert.deepEqual(payload.launchProfiles.projects[0].profiles[0].compute, { backend: 'scalar', workers: 3, maxElements: 1_000_000 });
  recovery.restore(payload);
  assert.equal(JSON.stringify(recovery.export()), serialized);
  const restored = services.profiles.get(alpha);
  assert.deepEqual(restored.arguments, []);
  assert.deepEqual(restored.environment, {});
  assert.equal(restored.runtimeSettings.enabled, false);
  assert.deepEqual(restored.runtimeSettings.allowedOrigins, []);
  services.dispose();
});

test('ZIP and extracted-folder manifests retain metadata while dropping hostile executable fields', () => {
  const services = workbench();
  configure(services);
  const payload = new SessionRecovery(services).export();
  const metadata = payload.launchProfiles.projects[0].profiles[0];
  Object.assign(metadata, { arguments: ['never-execute'], environment: { PRIVATE: 'never-import' },
    runtimeSettings: { enabled: true, allowedOrigins: ['https://never-import.example'] }, network: { enabled: true } });
  const records = projects.map(project => ({ path: project.id, text: '<Project />' }));
  const settings = { ...payload, name: 'TwoApps', mode: 'solution', startup: alpha };
  const zip = exportWorkspaceZip({ records, settings });
  const imported = importWorkspaceZip(zip);
  assert.deepEqual(imported.settings.startupConfiguration, payload.startupConfiguration);
  assert.equal(JSON.stringify(imported.settings).includes('never-'), false);
  const folder = importWorkspaceRecords([...records, workspaceManifestRecord(settings, records)]);
  assert.deepEqual(folder.settings, imported.settings);
  assert.deepEqual(new SessionRecovery(services).restore(folder.settings).restored, true);
  assert.deepEqual(sessionUserSettingsContributions.map(item => item.key), ['startupConfiguration', 'launchProfiles']);
  assert(Object.isFrozen(sessionUserSettingsContributions));
  services.dispose();
});

test('invalid recovery projects, libraries, selections and profile references fail before either live owner changes', () => {
  const services = workbench();
  configure(services);
  const recovery = new SessionRecovery(services);
  const before = recovery.export();
  const mutations = [
    value => { value.startupConfiguration.entries[0].projectId = 'Missing/Missing.csproj'; },
    value => { value.startupConfiguration.entries[0].projectId = projects[2].id; },
    value => { value.startupConfiguration.entries[0].profile = 'missing'; },
    value => { value.launchProfiles.projects[0].selected = 'missing'; },
    value => { value.launchProfiles.projects[0].profiles[0].compute.backend = 'unavailable'; },
    value => { value.launchProfiles.projects.push(value.launchProfiles.projects[0]); }
  ];
  for (const mutate of mutations) {
    const payload = structuredClone(before);
    mutate(payload);
    assert.throws(() => recovery.restore(payload));
    assert.deepEqual(recovery.export(), before);
    assert.equal(services.profiles.get(alpha).runtimeSettings.enabled, true);
  }
  services.dispose();
});

test('recovery staging is immutable, single-use and notifies observers only after both owners commit', () => {
  const services = workbench();
  configure(services);
  const recovery = new SessionRecovery(services);
  const payload = recovery.export();
  services.startup.select(beta);
  const token = recovery.prepare(payload);
  assert.throws(() => { token.metadata.startupConfiguration.entries[0].profile = 'mutated'; }, TypeError);
  assert.equal(services.startup.mode, 'single');
  const observed = [];
  const record = () => observed.push([services.startup.mode, services.profiles.get(alpha).runtimeSettings.enabled]);
  services.profiles.subscribe(record);
  services.startup.subscribe(record);
  recovery.apply(token);
  assert.deepEqual(observed, [['multiple', false], ['multiple', false]]);
  assert.throws(() => recovery.apply(token), { code: 'SESSION_RECOVERY_TOKEN' });
  services.dispose();
});

test('prospective recovery validates before workspace replacement and commits only to that loaded project set', () => {
  const previous = createWorkbenchServices({ workerFactory: fakeWorkers().factory,
    projects: [{ id: 'Old.csproj', files: [], outputType: 'exe' }] });
  previous.startup.select('Old.csproj');
  const imported = workbench();
  configure(imported);
  const payload = new SessionRecovery(imported).export();
  const recovery = new SessionRecovery(previous);
  const token = recovery.prepare(payload, { projects });
  assert.equal(previous.startup.entries[0].projectId, 'Old.csproj');
  assert.throws(() => recovery.apply(token), { code: 'SESSION_RECOVERY_STALE' });
  const valid = recovery.prepare(payload, { projects });
  previous.builds.remove('Old.csproj');
  for (const project of projects) previous.registerProject(project);
  recovery.apply(valid);
  assert.deepEqual(previous.startup.snapshot(), payload.startupConfiguration);
  imported.dispose();
  previous.dispose();
});

test('legacy records without session metadata are no-ops, while malformed versions, paths and bounds are rejected', () => {
  const services = workbench();
  configure(services);
  const recovery = new SessionRecovery(services);
  assert.deepEqual(recovery.restore({ name: 'legacy', runtimeSettings: { enabled: true } }), { restored: false });
  assert.equal(services.profiles.get(alpha).runtimeSettings.enabled, true);
  const start = { version: 1, mode: 'single', entries: [{ projectId: alpha, action: 'start' }] };
  assert.throws(() => sanitizeSessionUserSettings({ startupConfiguration: { ...start, version: 2 } }));
  assert.throws(() => sanitizeSessionUserSettings({ startupConfiguration: { ...start, entries: Array(1025).fill(start.entries[0]) } }));
  assert.throws(() => sanitizeSessionUserSettings({ startupConfiguration: { ...start, entries: [{ projectId: '../escape', action: 'start' }] } }));
  assert.throws(() => sanitizeSessionUserSettings({ launchProfiles: {
    version: 1, projects: [{ projectId: alpha, profiles: Array(65).fill({ id: 'profile' }) }]
  } }));
  assert.throws(() => recovery.prepare(' '.repeat(sessionUserSettingsLimits.characters + 1)), RangeError);
  const loose = sanitizeSessionUserSettings({ startupConfiguration: {
    version: 1, mode: 'single', entries: [{ projectId: '$workspace', action: 'start' }]
  } }, { paths: new Set(['Program.cs']) });
  assert.equal(loose.startupConfiguration.entries[0].projectId, '$workspace');
  services.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeProjectProfiles } from '../apps/studio/native-build/profiles.js';
import { nativeUiModelFixture } from './support/a23-native-ui-model.js';

function profileFixture() {
  const fixture = nativeUiModelFixture();
  const { host, files, calls } = fixture;
  const launchPath = 'App/Properties/launchSettings.json';
  files.set(launchPath, JSON.stringify({ profiles: {
    Local: {
      commandName: 'Project', commandLineArgs: 'one "two words"', workingDirectory: 'work',
      environmentVariables: { MODE: 'test' }, applicationUrl: 'http://localhost:8123'
    },
    Tool: { commandName: 'Executable', executablePath: 'tool.exe' }
  } }));
  host.workspace.files.push({ path: launchPath });
  host.client.publishProfiles = async request => {
    calls.push({ kind: 'profiles', request });
    return [{
      name: 'Folder', path: 'App/Properties/PublishProfiles/Folder.pubxml', inspectionOnly: true,
      properties: { PublishDir: { value: 'publish', evaluated: true }, PublishTrimmed: { value: '$(Trim)', evaluated: false } },
      diagnostics: []
    }];
  };
  host.profiles = new NativeProjectProfiles(host);
  return { ...fixture, profiles: host.profiles, launchPath };
}

test('profile model inspects launch/publish choices with explicit read-only operation options', async () => {
  const { host, profiles, calls } = profileFixture();
  host.settings.trusted = false;
  await profiles.refresh();
  assert.equal(profiles.launch.profiles.length, 2);
  assert.equal(profiles.publish.length, 1);
  profiles.selectPublish('Folder');
  profiles.selectLaunch('Local');
  assert.deepEqual(calls.filter(call => ['read', 'profiles'].includes(call.kind)).map(call => call.kind), ['read', 'profiles']);
  assert.deepEqual(calls.find(call => call.kind === 'operation').options, { trust: false, save: false });
  assert.equal(calls.some(call => ['attach', 'contexts', 'metadata', 'run', 'publish', 'save'].includes(call.kind)), false);
  assert.equal(profiles.publish[0].inspectionOnly, true);
  assert.equal(profiles.publish[0].properties.PublishTrimmed.evaluated, false);
});

test('profile model builds exact launch argv/environment/context requests without executing them', async () => {
  const { model, profiles, calls } = profileFixture();
  await model.load();
  await profiles.refresh();
  const request = profiles.runRequest();
  assert.deepEqual(request.arguments, ['one', 'two words']);
  assert.deepEqual(request.environment, { MODE: 'test', ASPNETCORE_URLS: 'http://localhost:8123' });
  assert.equal(request.workingDirectory, 'work');
  assert.equal(request.profile, 'Local');
  assert.equal(request.framework, 'net8.0');
  assert.equal(request.runOptions.contextId, model.active.id);
  assert.equal(request.noBuild, true);
  profiles.selectLaunch('Tool');
  const executable = profiles.runRequest();
  assert.equal(executable.runOptions.commandName, 'Executable');
  assert.equal(executable.runOptions.executablePath, 'tool.exe');
  profiles.launch.profiles.push({ name: 'Unsupported', commandName: 'IISExpress', supported: false });
  profiles.selectLaunch('Unsupported');
  assert.throws(() => profiles.runRequest(), /requires.*native host|requires a dedicated host adapter/);
  assert.equal(calls.some(call => call.kind === 'run'), false);
});

test('profile model builds only a selected publish request and rejects unknown or stale selections', async () => {
  const { host, model, profiles, calls } = profileFixture();
  await profiles.refresh();
  assert.throws(() => profiles.publishRequest(), /select an existing publish profile/);
  profiles.selectPublish('Folder');
  const request = profiles.publishRequest();
  assert.equal(request.profile, 'Folder');
  assert.equal(request.project, 'App/App.csproj');
  assert.equal(request.action, 'publish');
  assert.throws(() => profiles.selectPublish('Unknown'), /existing/);
  assert.throws(() => profiles.selectLaunch('Unknown'), /existing/);
  assert.equal(calls.some(call => call.kind === 'publish'), false);
  model.setProject('Other/Other.csproj');
  assert.equal(host.profiles.project, '');
  assert.throws(() => profiles.publishRequest(), /Read profiles/);
});

test('invalid launch JSON preserves its located diagnostic and rejects a launch request', async () => {
  const { files, profiles, launchPath } = profileFixture();
  files.set(launchPath, '{\n "profiles": { broken }');
  await profiles.refresh();
  const diagnostic = profiles.diagnostics[0];
  assert.equal(diagnostic.code, 'SFP1701');
  assert.equal(diagnostic.path, launchPath);
  assert.ok(diagnostic.line >= 1);
  assert.throws(() => profiles.runRequest(), /launch settings diagnostics/);
});

test('cancelled reads and oversized publish lists retain the last complete profile snapshot', async () => {
  const { host, profiles, cancel } = profileFixture();
  await profiles.refresh();
  profiles.selectPublish('Folder');
  const previous = profiles.snapshot();
  const read = host.client.read;
  host.client.read = async path => { cancel(); return read(path); };
  await assert.rejects(profiles.refresh(), { name: 'AbortError' });
  assert.deepEqual(profiles.snapshot(), previous);
  host.client.read = read;
  host.client.publishProfiles = async () => Array(1025).fill({ name: 'Too many' });
  await assert.rejects(profiles.refresh(), /Invalid publish profile list/);
  assert.deepEqual(profiles.snapshot(), previous);
});

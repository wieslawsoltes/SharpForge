import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeToolsFixture} from './support/a23-native-tools.js';

test('launch and publish profiles are listed and selected without trust, target execution or saves', async () => {
  const {tools, client, calls} = nativeToolsFixture();
  await tools.connect(client);
  await tools.profiles.refresh();
  assert.equal(tools.profiles.launch.profiles.length, 2);
  assert.equal(tools.profiles.publish.length, 1);
  tools.profiles.selectPublish('Folder');
  tools.profiles.selectLaunch('Local');
  assert.deepEqual(calls.map(call => call.kind), ['connect', 'read', 'profiles']);
  assert.equal(tools.profiles.publish[0].inspectionOnly, true);
  assert.equal(tools.profiles.publish[0].properties.PublishTrimmed.evaluated, false);
  await assert.rejects(tools.publishProfile(), /trust/);
  await tools.dispose();
});

test('selected launch profile preserves quoted arguments, environment, URLs, cwd and active native context', async () => {
  const {tools, client, calls} = nativeToolsFixture();
  await tools.connect(client);
  tools.settings.trusted = true;
  await tools.contexts.load();
  await tools.profiles.refresh();
  await tools.runProject();
  const request = calls.find(call => call.kind === 'run').request;
  assert.deepEqual(request.arguments, ['one', 'two words']);
  assert.deepEqual(request.environment, {MODE: 'test', ASPNETCORE_URLS: 'http://localhost:8123'});
  assert.equal(request.workingDirectory, 'work');
  assert.equal(request.profile, 'Local');
  assert.equal(request.framework, 'net8.0');
  assert.equal(request.runOptions.contextId, tools.contexts.active.id);
  assert.equal(request.noBuild, true);
  assert.equal(tools.log, 'native result');
  tools.profiles.selectLaunch('Tool');
  await tools.runProject();
  const executable = calls.filter(call => call.kind === 'run').at(-1).request;
  assert.equal(executable.runOptions.commandName, 'Executable');
  assert.equal(executable.runOptions.executablePath, 'tool.exe');
  assert.equal(calls.filter(call => call.kind === 'run').length, 2);
  tools.profiles.launch.profiles.push({name: 'Unsupported', commandName: 'IISExpress', supported: false});
  tools.profiles.selectLaunch('Unsupported');
  await assert.rejects(tools.runProject(), /requires its native host/);
  assert.equal(calls.filter(call => call.kind === 'run').length, 2);
  await tools.dispose();
});

test('explicit publish executes only the chosen profile and preserves build output monitoring', async () => {
  const {tools, client, calls} = nativeToolsFixture();
  await tools.connect(client);
  tools.settings.trusted = true;
  await tools.profiles.refresh();
  tools.profiles.selectPublish('Folder');
  const result = await tools.publishProfile();
  const request = calls.find(call => call.kind === 'publish').request;
  assert.equal(request.profile, 'Folder');
  assert.equal(request.project, 'App/App.csproj');
  assert.equal(request.action, 'publish');
  assert.equal(result.status, 'succeeded');
  assert.equal(tools.job.id, result.id);
  assert.throws(() => tools.profiles.selectPublish('Unknown'), /existing/);
  await tools.dispose();
});

test('invalid JSON keeps a located profile diagnostic and prevents native launch', async () => {
  const {tools, client, calls, files} = nativeToolsFixture();
  files.set('App/Properties/launchSettings.json', '{\n "profiles": { broken }');
  await tools.connect(client);
  tools.settings.trusted = true;
  await tools.profiles.refresh();
  const diagnostic = tools.profiles.diagnostics[0];
  assert.equal(diagnostic.code, 'SFP1701');
  assert.equal(diagnostic.path, 'App/Properties/launchSettings.json');
  assert.ok(diagnostic.line >= 1);
  await assert.rejects(tools.runProject(), /launch settings diagnostics/);
  assert.equal(calls.some(call => call.kind === 'run'), false);
  await tools.dispose();
});

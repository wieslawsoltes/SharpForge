import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildEnvironment, createLaunchEnvironment } from '../packages/msbuild/src/environment.js';
import { runNativeProject } from '../packages/msbuild/src/launch.js';
import { resolveNativeLaunchOptions } from '../packages/msbuild/src/launch-options.js';
import { NativeWorkspace } from '../packages/msbuild/src/workspace.js';
import { startMSBuildHost } from '../packages/msbuild/src/server.js';
import { MSBuildClient } from '../packages/msbuild/src/client.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sf-native-launch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'App/Properties'), { recursive: true });
  await mkdir(join(root, 'App/run folder'));
  await writeFile(join(root, 'App/App.csproj'), '<Project/>');
  const profiles = { profiles: {
    Blue: { commandName: 'Project', commandLineArgs: '"two words" "" λ', workingDirectory: 'run folder',
      environmentVariables: { APPLICATION_COLOR: 'blue', UNICODE_VALUE: 'zażółć λ' }, applicationUrl: 'http://localhost:5182',
      dotnetRunMessages: false },
    Red: { commandName: 'Project', commandLineArgs: 'red', environmentVariables: { APPLICATION_COLOR: 'red' } },
    External: { commandName: 'Executable', executablePath: '/not-authorized' }
  } };
  await writeFile(join(root, 'App/Properties/launchSettings.json'), '// profile settings\n' + JSON.stringify(profiles));
  return { root, workspace: await NativeWorkspace.open(root) };
}

test('launch environments carry only explicit application variables plus allowed tool-discovery inheritance', () => {
  const host = { PATH: '/tools', HOME: '/home/test', SECRET_FROM_HOST: 'must-not-inherit', DOTNET_STARTUP_HOOKS: '/unrequested.dll' };
  const environment = createLaunchEnvironment(host, { APPLICATION_COLOR: 'blue', UNICODE_VALUE: 'zażółć λ', EMPTY_VALUE: '' });
  assert.equal(environment.PATH, '/tools');
  assert.equal(environment.APPLICATION_COLOR, 'blue');
  assert.equal(environment.EMPTY_VALUE, '');
  assert.equal(environment.SECRET_FROM_HOST, undefined);
  assert.equal(environment.DOTNET_STARTUP_HOOKS, undefined);
  assert.throws(() => createBuildEnvironment(host, { APPLICATION_COLOR: 'blue' }), /not allowed/);
  for (const value of [{ 'not=a=name': 'x' }, { NAME: 'x\0y' }, { NAME: 'x'.repeat(65537) }, []]) {
    assert.throws(() => createLaunchEnvironment(host, value), { code: 'SFMSB_LAUNCH_ENVIRONMENT' });
  }
  assert.throws(() => createLaunchEnvironment(host, Object.fromEntries(Array.from({ length: 257 }, (_, index) => ['K' + index, 'v']))),
    { code: 'SFMSB_LAUNCH_ENVIRONMENT' });
});

test('saved and explicit launch profiles resolve arguments, URLs and granted working directories without shell interpolation', async t => {
  const { root, workspace } = await fixture(t);
  const request = { project: 'App/App.csproj', profile: 'Blue', trusted: true };
  const resolved = await resolveNativeLaunchOptions(workspace, request);
  assert.deepEqual(resolved.args, ['two words', '', 'λ']);
  assert.equal(resolved.environment.ASPNETCORE_URLS, 'http://localhost:5182');
  assert.equal(resolved.environment.DOTNET_LAUNCH_PROFILE, 'Blue');
  assert.equal(resolved.workingDirectory, join(root, 'App/run folder'));
  let captured;
  const engine = { workspace, async authorize(value) { assert.equal(value.trusted, true); }, async runTool(value) { captured = value; return value; } };
  await runNativeProject(engine, { ...request, runOptions: { project: request.project, profile: 'Blue', commandName: 'Project',
    args: ['$(literal)', ';literal'], environment: { APPLICATION_COLOR: 'explicit' }, workingDirectory: 'run folder' } });
  assert.deepEqual(captured.arguments.slice(-3), ['--', '$(literal)', ';literal']);
  assert.equal(captured.environmentMode, 'launch');
  assert.equal(captured.environment.APPLICATION_COLOR, 'explicit');
  assert(captured.arguments.includes('--no-launch-profile'));
  assert(captured.arguments.some(argument => argument.startsWith('--property:RunWorkingDirectory=')));
  await assert.rejects(resolveNativeLaunchOptions(workspace, { ...request, profile: 'Missing' }), { code: 'SFP1701' });
  await assert.rejects(resolveNativeLaunchOptions(workspace, { ...request, profile: 'External' }), { code: 'SFMSB_LAUNCH_EXECUTABLE' });
  await assert.rejects(resolveNativeLaunchOptions(workspace, { ...request, runOptions: { project: request.project, profile: 'Blue',
    commandName: 'IISExpress' } }), { code: 'SFMSB_LAUNCH_ADAPTER' });
  await assert.rejects(resolveNativeLaunchOptions(workspace, { ...request, workingDirectory: '../..' }), { code: 'SFMSB_LAUNCH_DIRECTORY' });
  await assert.rejects(resolveNativeLaunchOptions(workspace, { ...request, runOptions: { project: 'Other.csproj' } }), { code: 'SFMSB_LAUNCH_OPTIONS' });
  await assert.rejects(resolveNativeLaunchOptions(workspace, { ...request, arguments: ['a\0b'] }), { code: 'SFMSB_LAUNCH_OPTIONS' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runNativeProject(engine, request, { signal: controller.signal }), { name: 'AbortError' });
  await writeFile(join(root, 'App/Properties/launchSettings.json'), '{\n "profiles": ] }');
  await assert.rejects(resolveNativeLaunchOptions(workspace, request), error => error.code === 'SFP1701'
    && error.diagnostics[0].line === 2 && error.path === 'App/Properties/launchSettings.json');
});

test('actual native launches apply selected and explicit profile data through authenticated HTTP', {
  skip: process.env.SHARPFORGE_DOTNET ? false : 'Set SHARPFORGE_DOTNET for native launch qualification', timeout: 90000
}, async t => {
  const { root } = await fixture(t);
  const sdk = process.env.SHARPFORGE_NATIVE_SDK ?? '10.0.201';
  const framework = 'net' + sdk.split('.')[0] + '.0';
  await writeFile(join(root, 'global.json'), JSON.stringify({ sdk: { version: sdk, rollForward: 'disable' } }));
  await writeFile(join(root, 'NuGet.Config'), '<configuration><packageSources><clear/></packageSources></configuration>');
  await writeFile(join(root, 'App/App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + `<TargetFramework>${framework}</TargetFramework><OutputType>Exe</OutputType></PropertyGroup></Project>`);
  await writeFile(join(root, 'App/Program.cs'), 'using System; using System.Text.Json; class Program { static void Main(string[] args) {'
    + 'if(args.Length > 0 && args[0] == "wait") System.Threading.Thread.Sleep(30000);'
    + 'Console.WriteLine(JsonSerializer.Serialize(new { args, directory = Environment.CurrentDirectory,'
    + 'color = Environment.GetEnvironmentVariable("APPLICATION_COLOR"), unicode = Environment.GetEnvironmentVariable("UNICODE_VALUE"),'
    + 'url = Environment.GetEnvironmentVariable("ASPNETCORE_URLS"), profile = Environment.GetEnvironmentVariable("DOTNET_LAUNCH_PROFILE") })); } }');
  const host = await startMSBuildHost({ root, port: 0, executable: process.env.SHARPFORGE_DOTNET, trusted: true });
  t.after(() => host.close());
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  const request = { project: 'App/App.csproj', framework, configuration: 'Debug', trusted: true };
  const build = await host.engine.wait((await host.engine.start({ ...request, action: 'build', restore: true })).id);
  assert.equal(build.status, 'succeeded', build.error);
  const blue = await client.runProject({ ...request, profile: 'Blue' });
  assert.equal(blue.exitCode, 0, blue.stdout + blue.stderr);
  const data = JSON.parse(blue.stdout.trim());
  assert.deepEqual(data, { args: ['two words', '', 'λ'], directory: join(root, 'App/run folder'), color: 'blue', unicode: 'zażółć λ',
    url: 'http://localhost:5182', profile: 'Blue' });
  const red = await client.runProject({ ...request, profile: 'Red', runOptions: { project: request.project, profile: 'Red',
    commandName: 'Project', args: ['explicit', 'two words'], environment: { APPLICATION_COLOR: 'overridden' }, workingDirectory: '.' } });
  assert.equal(red.exitCode, 0, red.stdout + red.stderr);
  assert.deepEqual(JSON.parse(red.stdout.trim()), { args: ['explicit', 'two words'], directory: join(root, 'App'),
    color: 'overridden', unicode: null, url: null, profile: 'Red' });
  const executablePath = `bin/Debug/${framework}/App` + (process.platform === 'win32' ? '.exe' : '');
  await writeFile(join(root, 'App/Properties/launchSettings.json'), JSON.stringify({ profiles: { LocalExecutable: {
    commandName: 'Executable', executablePath, commandLineArgs: 'local "two words"', workingDirectory: 'run folder',
    environmentVariables: { APPLICATION_COLOR: 'local' }
  } } }));
  const local = await client.runProject({ ...request, profile: 'LocalExecutable' });
  assert.equal(local.exitCode, 0, local.stdout + local.stderr);
  assert.deepEqual(JSON.parse(local.stdout.trim()), { args: ['local', 'two words'], directory: join(root, 'App/run folder'),
    color: 'local', unicode: null, url: null, profile: 'LocalExecutable' });
  await assert.rejects(client.runProject({ ...request, profile: 'LocalExecutable', trusted: false }), { status: 403, code: 'SFMSB_UNTRUSTED' });
  const timedOut = await client.runProject({ ...request, profile: 'LocalExecutable', arguments: ['wait'], timeoutMs: 200 });
  assert.equal(timedOut.timedOut, true);
  const controller = new AbortController();
  let pid;
  const cancelled = await runNativeProject(host.engine, { ...request, profile: 'LocalExecutable', arguments: ['wait'] }, {
    signal: controller.signal, onStart(value) { pid = value.pid; controller.abort(); }
  });
  assert.equal(cancelled.cancelled, true);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await writeFile(join(root, 'App/Properties/launchSettings.json'), '{\n "profiles": ] }');
  await assert.rejects(client.runProject({ ...request, profile: 'Blue' }), error => error.code === 'SFP1701'
    && error.path === 'App/Properties/launchSettings.json' && error.diagnostics[0].line === 2);
});

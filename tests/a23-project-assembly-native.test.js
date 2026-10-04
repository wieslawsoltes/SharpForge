import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadProjectAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, createProjectAssemblyInspector} from '@sharpforge/runtime';
import {counterLibrarySource, counterApplicationSource, projectApplication, projectLibrary} from './support/project-assembly-fixtures.js';

const dotnet = process.env.SF_NATIVE_DOTNET ?? process.env.SHARPFORGE_DOTNET ?? process.env.DOTNET_HOST_PATH ?? 'dotnet';
const probe = spawnSync(dotnet, ['--version'], {encoding: 'utf8', timeout: 15000});
const skip = probe.status === 0 ? false : 'An actual installed .NET SDK is required for cross-assembly CLR qualification';
const normalize = text => text.replaceAll('\r\n', '\n');

function invoke(arguments_, options = {}) {
  const result = spawnSync(dotnet, arguments_, {encoding: 'utf8', timeout: 60000, ...options,
    env: {...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1'}});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('separate project PEs preserve constructors and static fields on Roslyn, actual CLR and both JavaScript engines', {skip}, async t => {
  const sdk = probe.stdout.trim();
  const framework = 'net' + sdk.split('.')[0] + '.0';
  const directory = await mkdtemp(join(tmpdir(), 'sf-project-assemblies-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const reference = join(directory, 'reference');
  const emitted = join(directory, 'emitted');
  await mkdir(join(reference, 'Library'), {recursive: true});
  await mkdir(join(reference, 'App'));
  await mkdir(emitted);
  await writeFile(join(reference, 'global.json'), JSON.stringify({sdk: {version: sdk, rollForward: 'disable'}}));
  await writeFile(join(reference, 'NuGet.Config'), '<configuration><packageSources><clear/></packageSources></configuration>');
  const properties = '<PropertyGroup><TargetFramework>' + framework + '</TargetFramework></PropertyGroup>';
  await writeFile(join(reference, 'Library/Library.csproj'), '<Project Sdk="Microsoft.NET.Sdk">' + properties + '</Project>');
  await writeFile(join(reference, 'Library/Counter.cs'), counterLibrarySource);
  await writeFile(join(reference, 'App/App.csproj'), '<Project Sdk="Microsoft.NET.Sdk">' + properties
    + '<PropertyGroup><OutputType>Exe</OutputType></PropertyGroup>'
    + '<ItemGroup><ProjectReference Include="../Library/Library.csproj"/></ItemGroup></Project>');
  await writeFile(join(reference, 'App/Program.cs'), counterApplicationSource);
  invoke(['build', 'App/App.csproj', '--nologo', '--verbosity:quiet', '--disable-build-servers'], {cwd: reference});
  const expected = normalize(invoke([join(reference, 'App/bin/Debug', framework, 'App.dll')]));
  assert.equal(expected, '42\n42\n44\nnull\n');
  const library = projectLibrary();
  const application = projectApplication(counterApplicationSource, [library]);
  await writeFile(join(emitted, 'Library.dll'), library.assembly);
  await writeFile(join(emitted, 'App.dll'), application.assembly);
  const runtimes = invoke(['--list-runtimes']);
  const runtime = runtimes.split(/\r?\n/).map(line => /^Microsoft\.NETCore\.App (\S+)/.exec(line)?.[1])
    .filter(Boolean).find(version => version.split('.')[0] === sdk.split('.')[0]);
  assert(runtime, 'The selected SDK must have its matching CLR for actual PE execution');
  await writeFile(join(emitted, 'App.runtimeconfig.json'), JSON.stringify({runtimeOptions: {
    tfm: framework, framework: {name: 'Microsoft.NETCore.App', version: runtime},
  }}));
  const actualClr = normalize(invoke([join(emitted, 'App.dll')]));
  assert.equal(actualClr, expected);
  const options = {dependencies: [{assembly: library.assembly}]};
  const graph = loadProjectAssembly(application.assembly, options);
  const direct = createProjectAssemblyInspector(application.assembly, options);
  for (const machine of [new VirtualMachine(graph.image), new CilVirtualMachine(direct)]) {
    const result = machine.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(normalize(result.output), expected);
  }
  t.diagnostic(JSON.stringify({sdk, msbuild: invoke(['msbuild', '-version', '-nologo']).trim(), runtime,
    framework, platform: process.platform, architecture: process.arch, output: expected,
    engines: ['Roslyn SDK build on CLR', 'SharpForge separate PE on CLR', 'SourceVM', 'CilVirtualMachine']}));
});

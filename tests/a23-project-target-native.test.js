import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectSystem} from '@sharpforge/project-system';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {requestProjectCompilation} from '../apps/studio/project-build.js';
import {compileProjectPlan} from '../apps/studio/workers/compilation-handler.js';
import {projectBuildOrderFiles} from './support/project-build-order-fixture.js';

const executable = process.env.SHARPFORGE_DOTNET ?? process.env.DOTNET_HOST_PATH ?? 'dotnet';
const probe = spawnSync(executable, ['--version'], {encoding: 'utf8', timeout: 15000});
const skip = probe.status !== 0 ? 'An installed .NET SDK is required for native target-order qualification' : false;

test('dependency-generated consumer source and execution match an actual offline SDK build', {skip}, async t => {
  const sdk = probe.stdout.trim();
  const framework = 'net' + sdk.split('.')[0] + '.0';
  const directory = await mkdtemp(join(tmpdir(), 'sf-target-order-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const files = projectBuildOrderFiles({framework});
  files.push({path: 'global.json', text: JSON.stringify({sdk: {version: sdk, rollForward: 'disable'}})},
    {path: 'NuGet.Config', text: '<configuration><packageSources><clear/></packageSources></configuration>'});
  for (const file of files) {
    const path = join(directory, file.path);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, file.text);
  }
  await mkdir(join(directory, 'Shared'));
  const build = spawnSync(executable, ['build', 'App/App.csproj', '--nologo', '--verbosity:quiet', '--disable-build-servers'], {
    cwd: directory, encoding: 'utf8', timeout: 60000,
    env: {...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1'},
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const projectSystem = new ProjectSystem(files);
  projectSystem.load('App/App.csproj');
  const state = {projectSystem, startupProject: 'App/App.csproj', files: [], revision: 1};
  const result = await requestProjectCompilation(state, {request: (_method, request) => compileProjectPlan(request.buildPlan)}, 'build');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  const normalize = text => text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  for (const path of ['Shared/Version.cs', 'App/Generated.cs']) {
    assert.equal(normalize(projectSystem.files.get(path).text), normalize(await readFile(join(directory, path), 'utf8')), path);
  }
  const native = spawnSync(executable, [join(directory, 'App/bin/Debug', framework, 'App.dll')], {encoding: 'utf8', timeout: 15000});
  assert.equal(native.status, 0, native.stdout + native.stderr);
  for (const machine of [new VirtualMachine(result.image), new CilVirtualMachine(result.assembly)]) {
    assert.equal(normalize(machine.run().output), normalize(native.stdout));
  }
  const msbuild = spawnSync(executable, ['msbuild', '-version', '-nologo'], {encoding: 'utf8', timeout: 15000});
  assert.equal(msbuild.status, 0, msbuild.stdout + msbuild.stderr);
  t.diagnostic(JSON.stringify({sdk, msbuild: msbuild.stdout.trim(), framework, platform: process.platform,
    architecture: process.arch, sourceFilesEqual: true, nativeOutput: native.stdout.trim(), portableEngines: ['SourceVM', 'CilVirtualMachine']}));
});

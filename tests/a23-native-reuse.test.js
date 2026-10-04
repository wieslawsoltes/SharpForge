import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { NativeWorkspace, NativeMSBuild } from '@sharpforge/msbuild/node';
import { shutdownBuildServers } from '../packages/msbuild/src/build-server.js';

const failureOutput = job => [job.error, ...job.events.map(event => event.text)].filter(Boolean).join('\n').slice(0, 16384);

test('build server shutdown invokes the SDK command and reports an unsuccessful shutdown explicitly', async () => {
  for (const exitCode of [0, 3]) {
    const promise = shutdownBuildServers({ executable: 'selected-dotnet', cwd: process.cwd(),
      spawnProcess(executable, args, options) {
        assert.equal(executable, 'selected-dotnet');
        assert.deepEqual(args, ['build-server', 'shutdown']);
        return spawn(process.execPath, ['-e', 'process.stderr.write("shutdown fixture");process.exit(' + exitCode + ')'], options);
      } });
    if (exitCode) await assert.rejects(promise, { code: 'SFMSB_SERVER_SHUTDOWN' });
    else assert.equal((await promise).exitCode, 0);
  }
});

async function linuxBuildServers() {
  const processes = new Map();
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const command = await readFile('/proc/' + entry + '/cmdline', 'utf8');
      const msbuild = /MSBuild\.dll\0/.test(command) && /[/\-]nodemode:1\0/i.test(command);
      const compiler = /VBCSCompiler\.dll\0/.test(command);
      if (!msbuild && !compiler) continue;
      const stat = await readFile('/proc/' + entry + '/stat', 'utf8');
      const values = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (values[0] !== 'Z') processes.set(Number(entry), { started: values[19], kind: msbuild ? 'MSBuild' : 'compiler' });
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
    }
  }
  return processes;
}

test('actual reusable builds record first/repeat timings and close their live MSBuild/compiler workers', {
  skip: process.env.SHARPFORGE_DOTNET && process.platform === 'linux' ? false
    : 'Requires SHARPFORGE_DOTNET and Linux /proc for real child-process cleanup qualification',
  timeout: 120000
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-reusable-build-'));
  let engine;
  t.after(async () => {
    try { await engine?.close(); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  const sdk = process.env.SHARPFORGE_NATIVE_SDK ?? '10.0.201';
  const framework = 'net' + sdk.split('.')[0] + '.0';
  await writeFile(join(root, 'global.json'), JSON.stringify({ sdk: { version: sdk, rollForward: 'disable' } }));
  await writeFile(join(root, 'NuGet.Config'), '<configuration><packageSources><clear/></packageSources></configuration>');
  for (const name of ['First', 'Second']) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, name + '.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
      + `<TargetFramework>${framework}</TargetFramework><EnableNETAnalyzers>false</EnableNETAnalyzers></PropertyGroup></Project>`);
    await writeFile(join(root, name, name + '.cs'), `public class ${name} { public static int Answer() => 42; }`);
  }
  await writeFile(join(root, 'Build.proj'), '<Project><ItemGroup><Child Include="First/First.csproj;Second/Second.csproj"/></ItemGroup>'
    + '<Target Name="Restore"><MSBuild Projects="@(Child)" Targets="Restore" BuildInParallel="true"/></Target>'
    + '<Target Name="Build"><MSBuild Projects="@(Child)" Targets="Build" BuildInParallel="true"/></Target></Project>');
  engine = new NativeMSBuild(await NativeWorkspace.open(root), {
    executable: process.env.SHARPFORGE_DOTNET, trusted: true, timeoutMs: 60000
  });
  const restore = await engine.wait((await engine.start({ project: 'Build.proj', action: 'restore', trusted: true, maxNodes: 3 })).id);
  assert.equal(restore.status, 'succeeded', failureOutput(restore));
  const baseline = await linuxBuildServers();
  const request = { project: 'Build.proj', action: 'build', trusted: true, maxNodes: 3, nodeReuse: true, compilerServer: true };
  const timings = [];
  for (let index = 0; index < 2; index++) {
    const started = performance.now();
    const result = await engine.wait((await engine.start(request)).id);
    timings.push(performance.now() - started);
    assert.equal(result.status, 'succeeded', failureOutput(result));
    assert(result.invocation.arguments.includes('-nodeReuse:true'));
    assert(result.invocation.arguments.includes('-p:UseSharedCompilation=true'));
  }
  const active = await linuxBuildServers();
  const owned = [...active].filter(([pid, info]) => baseline.get(pid)?.started !== info.started);
  assert(owned.some(([, info]) => info.kind === 'MSBuild'), 'The fixture must actually start at least one reusable MSBuild worker');
  await engine.close();
  const after = await linuxBuildServers();
  const survivors = owned.filter(([pid, info]) => after.get(pid)?.started === info.started);
  assert.deepEqual(survivors, [], 'No live MSBuild/compiler workers created by this fixture may survive host close');
  const measurement = { sdk, node: process.version, platform: process.platform, architecture: process.arch,
    firstBuildMs: timings[0], repeatBuildMs: timings[1], repeatRatio: timings[1] / timings[0],
    secondBuildFaster: timings[1] < timings[0], createdWorkerCount: owned.length, survivingWorkerCount: survivors.length,
    note: 'Same unchanged project; timings include incremental build effects and are not an isolated node-reuse speedup comparison.' };
  if (process.env.SHARPFORGE_REUSE_REPORT) await writeFile(process.env.SHARPFORGE_REUSE_REPORT, JSON.stringify(measurement, null, 2) + '\n');
  t.diagnostic(JSON.stringify(measurement));
});

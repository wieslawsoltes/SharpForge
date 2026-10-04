import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeWorkspace } from '../packages/msbuild/src/workspace.js';
import { NativeMSBuild } from '../packages/msbuild/src/engine.js';
import { DesignTimeBuildService } from '../packages/msbuild/src/design-time.js';
import { NativeBinlogReader } from '../packages/msbuild/src/binlog/reader.js';
import { NativeBuildService } from '../packages/msbuild/src/build-service.js';
import { NativeProjectGraphService } from '../packages/msbuild/src/native-project-graph.js';
import { discoverSdkEnvironment } from '../packages/msbuild/src/sdk-discovery.js';
import { createQualificationFixtures } from '../packages/msbuild/qualification/fixtures.js';
import { discoverPublishProfiles, createPublishProfileRequest } from '../packages/msbuild/src/publish-profiles.js';

const executable = process.env.SHARPFORGE_DOTNET;
test('installed SDK: restore/build, design-time inputs/cache, no-op build, binlog replay, publish profile', {
  skip: executable ? false : 'Set SHARPFORGE_DOTNET to qualify a real installed SDK; simulator results do not qualify this test', timeout: 180000
}, async t => {
  const inventory = await discoverSdkEnvironment({ executable });
  assert.equal(inventory.available, true, inventory.error);
  const sdk = process.env.SHARPFORGE_NATIVE_SDK ? inventory.sdks.find(item => item.version === process.env.SHARPFORGE_NATIVE_SDK) :
    inventory.sdks.at(-1);
  assert(sdk, 'The requested native integration SDK must be installed');
  const root = await mkdtemp(join(tmpdir(), 'sf-native-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createQualificationFixtures(root, sdk), workspace = await NativeWorkspace.open(root);
  const engine = new NativeMSBuild(workspace, { executable, trusted: true });
  t.after(() => engine.close());
  const restore = await engine.wait((await engine.start({ project: 'App/App.csproj', action: 'restore', trusted: true })).id);
  assert.equal(restore.status, 'succeeded', restore.error + JSON.stringify(restore.diagnostics));
  const contextService = new DesignTimeBuildService(engine);
  const first = await contextService.context({ project: 'App/App.csproj', trusted: true });
  assert(first.context.sources.some(source => source.path.endsWith('Program.cs')));
  assert(first.context.references.some(reference => reference.path.endsWith('System.Runtime.dll')));
  assert(first.context.generatedSources.some(source => source.path.endsWith('GlobalUsings.g.cs')));
  assert(first.context.sources.every(source => !source.path.startsWith(root)));
  assert(first.context.generatedSources.every(source => source.readOnly));
  await assert.rejects(lstat(join(root, `App/bin/Debug/${fixture.framework}/App.dll`)), { code: 'ENOENT' });
  assert.equal((await contextService.context({ project: 'App/App.csproj', trusted: true })).cached, true);
  const build = await engine.wait((await engine.start({ project: 'App/App.csproj', trusted: true, binaryLog: true })).id);
  assert.equal(build.status, 'succeeded', build.error + JSON.stringify(build.diagnostics));
  assert(build.artifacts.some(artifact => artifact.path.endsWith('/App.dll')));
  const service = new NativeBuildService(engine);
  const input = { project: 'App/App.csproj', trusted: true, fastUpToDate: true,
    inputs: [join(root, 'App/Program.cs')], outputs: [join(root, `App/bin/Debug/${fixture.framework}/App.dll`)] };
  assert.equal((await service.build(input)).skipped, false);
  assert.equal((await service.build(input)).skipped, true);
  const graph = new NativeProjectGraphService(engine, contextService);
  const leaf = await graph.build({ project: 'App/App.csproj', trusted: true, changedPaths: ['App/Program.cs'] });
  assert.equal(leaf.status, 'succeeded', JSON.stringify(leaf.results));
  assert.deepEqual(leaf.results.map(result => result.request.project), ['App/App.csproj']);
  await writeFile(join(root, 'Library/Library.cs'), 'namespace Qualification; public static class Library { public const int Answer = 43; }');
  const shared = await graph.build({ project: 'App/App.csproj', trusted: true, changedPaths: ['Library/Library.cs'] });
  assert.equal(shared.status, 'succeeded', JSON.stringify(shared.results));
  assert.deepEqual(shared.results.map(result => result.request.project), ['Library/Library.csproj', 'App/App.csproj']);
  await writeFile(join(root, 'App/Extra.cs'), 'internal class Extra {}');
  const expanded = await contextService.context({ project: 'App/App.csproj', trusted: true });
  assert.equal(expanded.cached, false);
  assert(expanded.context.sources.some(source => source.path === 'App/Extra.cs'));
  await writeFile(join(root, 'Directory.Build.props'), '<Project><PropertyGroup><DefineConstants>CHANGED_IMPORT</DefineConstants></PropertyGroup></Project>');
  const imported = await contextService.context({ project: 'App/App.csproj', trusted: true });
  assert.equal(imported.cached, false);
  assert(imported.context.defines.includes('CHANGED_IMPORT'));
  const reader = new NativeBinlogReader(engine), log = await reader.query(build.id, { kind: 'tree' });
  assert(log.summary.nodes > 1);
  assert.equal(log.summary.errors, 0);
  await mkdir(join(root, 'App/Properties/PublishProfiles'), { recursive: true });
  await writeFile(join(root, 'App/Properties/PublishProfiles/Folder.pubxml'),
    '<Project><PropertyGroup><PublishDir>published/</PublishDir><SelfContained>false</SelfContained></PropertyGroup></Project>');
  const profiles = await discoverPublishProfiles(workspace, 'App/App.csproj');
  const publish = await engine.wait((await engine.start(createPublishProfileRequest({ project: 'App/App.csproj', trusted: true }, profiles[0]))).id);
  assert.equal(publish.status, 'succeeded', publish.error);
  assert((await lstat(join(root, 'App/published/App.dll'))).isFile());
  t.diagnostic('Real native SDK qualification: ' + sdk.version + ' on ' + process.platform + '/' + process.arch);
});

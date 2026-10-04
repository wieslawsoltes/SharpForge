import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectSystem } from '@sharpforge/project-system';
import { NativeWorkspace } from '../packages/msbuild/src/workspace.js';
import { NativeMSBuild } from '../packages/msbuild/src/engine.js';
import { NuGetPackageService } from '../packages/msbuild/src/nuget/operations.js';
import { readNuGetConfiguration } from '../packages/msbuild/src/nuget/config-node.js';
import { readProjectAssets } from '../packages/msbuild/src/nuget/assets.js';
import { readPackagesLock, writePackagesLock, lockedRestoreRequest } from '../packages/msbuild/src/nuget/lock-file.js';
import { readNuGetPackage, selectPackageAssets } from '../packages/msbuild/src/nuget/package-reader.js';
import { discoverSdkEnvironment } from '../packages/msbuild/src/sdk-discovery.js';

const executable = process.env.SHARPFORGE_DOTNET;

test('local packed feed: hierarchy, minimal package edits, assets, lock drift and central versions use the actual SDK', {
  skip: executable ? false : 'Set SHARPFORGE_DOTNET for the offline native package workflow', timeout: 180000
}, async t => {
  const inventory = await discoverSdkEnvironment({ executable });
  const sdk = process.env.SHARPFORGE_NATIVE_SDK ?? inventory.sdks.at(-1)?.version;
  assert(sdk, inventory.error);
  const framework = 'net' + sdk.split('.')[0] + '.0';
  const root = await mkdtemp(join(tmpdir(), 'sf-package-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['feed', 'Producer', 'Consumer', 'Central']) await mkdir(join(root, directory));
  const consumer = `<Project Sdk='Microsoft.NET.Sdk'>\r\n  <!-- retain this comment and quote style -->\r\n` +
    `  <PropertyGroup><TargetFramework>${framework}</TargetFramework><NuGetAudit>false</NuGetAudit></PropertyGroup>\r\n</Project>\r\n`;
  const files = {
    'global.json': JSON.stringify({ sdk: { version: sdk, rollForward: 'disable' } }),
    'NuGet.Config': '<configuration><packageSources><clear/><add key="local" value="feed"/>' +
      '<add key="unused" value="https://example.invalid/v3/index.json"/></packageSources>' +
      '<disabledPackageSources><add key="unused" value="true"/></disabledPackageSources>' +
      '<packageSourceCredentials><unused><add key="Username" value="fixture-user"/><add key="ClearTextPassword" value="fixture-password-must-not-escape"/>' +
      '</unused></packageSourceCredentials><config><add key="globalPackagesFolder" value=".packages"/></config></configuration>',
    'Producer/Producer.csproj': `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>${framework}</TargetFramework>` +
      '<PackageId>Local.Dependency</PackageId><Version>1.0.0</Version><NuGetAudit>false</NuGetAudit></PropertyGroup>' +
      '<ItemGroup Condition="\'$(PackageId)\' == \'Local.Example\'"><PackageReference Include="Local.Dependency" Version="1.0.0"/>' +
      '</ItemGroup></Project>',
    'Producer/Value.cs': 'namespace Fixture; public class Value { public static int Answer => 42; }',
    'Consumer/Consumer.csproj': consumer,
    'Central/Central.csproj': consumer,
    'Central/Directory.Packages.props': '<Project><PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>' +
      '</PropertyGroup></Project>'
  };
  for (const [path, source] of Object.entries(files)) await writeFile(join(root, path), source);
  const workspace = await NativeWorkspace.open(root);
  const engine = new NativeMSBuild(workspace, { executable, trusted: true });
  t.after(() => engine.close());
  async function completed(request) {
    const result = await engine.wait((await engine.start({ trusted: true, ...request })).id);
    assert.equal(result.status, 'succeeded', JSON.stringify({ request, error: result.error, diagnostics: result.diagnostics, events: result.events }));
    return result;
  }
  for (const [id, version] of [['Local.Dependency', '1.0.0'], ['Local.Example', '1.0.0'], ['Local.Example', '2.0.0']]) {
    await completed({ project: 'Producer/Producer.csproj', action: 'pack', restore: true, properties: { PackageId: id, Version: version } });
    await copyFile(join(root, 'Producer/bin/Debug', id + '.' + version + '.nupkg'), join(root, 'feed', id + '.' + version + '.nupkg'));
  }
  const configuration = await readNuGetConfiguration(root);
  const nativeSources = await engine.runTool({ arguments: ['nuget', 'list', 'source', '--format', 'short'], trusted: true });
  assert.equal(nativeSources.exitCode, 0, nativeSources.stderr);
  const expectedSources = configuration.sources.map(source => `${source.enabled ? 'E' : 'D'} ${source.url.replaceAll('\\', '/')}`).sort();
  const actualSources = nativeSources.stdout.trim().split(/\r?\n/).map(line => line.replaceAll('\\', '/')).sort();
  assert.deepEqual(actualSources, expectedSources);
  assert(!JSON.stringify(configuration).includes('fixture-password-must-not-escape'));
  const service = new NuGetPackageService(engine);
  async function change(request) {
    const result = await service.change({ project: 'Consumer/Consumer.csproj', id: 'Local.Example', trusted: true, ...request });
    const restored = await engine.wait(result.restoreJobId);
    assert.equal(restored.status, 'succeeded', JSON.stringify(restored.diagnostics));
    return result;
  }
  await change({ operation: 'add', version: '1.0.0' });
  const edited = await readFile(join(root, 'Consumer/Consumer.csproj'), 'utf8');
  assert(edited.startsWith(consumer.slice(0, consumer.indexOf('</Project>'))));
  assert(edited.endsWith('</Project>\r\n'));
  const graph = readProjectAssets(await readFile(join(root, 'Consumer/obj/project.assets.json'), 'utf8'));
  const nodes = graph.frameworks.find(item => item.targetFramework === framework).nodes;
  assert.equal(nodes.find(node => node.id === 'Local.Example').direct, true);
  assert.equal(nodes.find(node => node.id === 'Local.Dependency').transitive, true);
  const nativePackages = await service.query({ project: 'Consumer/Consumer.csproj', trusted: true });
  const packages = nativePackages.document.projects[0].frameworks[0];
  assert.deepEqual(packages.topLevelPackages.map(item => item.id), nodes.filter(node => node.direct).map(node => node.id));
  assert.deepEqual(packages.transitivePackages.map(item => item.id), nodes.filter(node => node.transitive).map(node => node.id));
  const bytes = new Uint8Array(await readFile(join(root, 'feed/Local.Example.1.0.0.nupkg')));
  const assets = selectPackageAssets(readNuGetPackage(bytes), framework);
  const restoredAssets = nodes.find(node => node.id === 'Local.Example');
  assert.deepEqual(assets.compile, restoredAssets.compile);
  assert.deepEqual(assets.runtime, restoredAssets.runtime);
  await completed(lockedRestoreRequest({ project: 'Consumer/Consumer.csproj' }, { locked: false }));
  const lockText = await readFile(join(root, 'Consumer/packages.lock.json'), 'utf8');
  assert.equal(writePackagesLock(readPackagesLock(lockText)), lockText);
  const current = await workspace.read('Consumer/Consumer.csproj');
  await workspace.save([{ path: current.path, expectedHash: current.hash, text: current.text.replace('1.0.0', '2.0.0') }]);
  const drift = await engine.wait((await engine.start(lockedRestoreRequest({ project: current.path, trusted: true }))).id);
  assert.equal(drift.status, 'failed');
  assert(drift.diagnostics.some(diagnostic => diagnostic.code === 'NU1004'));
  await change({ operation: 'update', version: '2.0.0' });
  await change({ operation: 'remove' });
  assert(!(await readFile(join(root, 'Consumer/Consumer.csproj'), 'utf8')).includes('PackageReference'));
  await change({ project: 'Central/Central.csproj', centralPath: 'Central/Directory.Packages.props', operation: 'add', version: '2.0.0' });
  const centralProject = await readFile(join(root, 'Central/Central.csproj'), 'utf8');
  const centralProperties = await readFile(join(root, 'Central/Directory.Packages.props'), 'utf8');
  assert.match(centralProperties, /PackageVersion Include="Local.Example"/);
  assert(!centralProject.includes('<Version>'));
  const portable = new ProjectSystem([{ path: 'Central/Central.csproj', text: centralProject },
    { path: 'Central/Directory.Packages.props', text: centralProperties }]);
  portable.load('Central/Central.csproj');
  const evaluated = portable.evaluateProject('Central/Central.csproj');
  assert.equal(evaluated.packageReferences.find(item => item.name === 'Local.Example')?.version, '2.0.0');
  t.diagnostic(JSON.stringify({ sdk, platform: process.platform, architecture: process.arch,
    feed: 'three locally SDK-packed packages; no external feed', packages: nodes.map(node => node.identity) }));
});

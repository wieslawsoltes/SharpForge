import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSdkList, parseRuntimeList, parseDotnetInfo } from '../packages/msbuild/src/sdk-discovery.js';
import { resolveSdk } from '../packages/msbuild/src/global-json.js';
import { parseWorkloadList, explainTargetAvailability } from '../packages/msbuild/src/workloads.js';
import { ProjectBuildGraph } from '../packages/msbuild/src/project-graph.js';
import { FastUpToDateCheck } from '../packages/msbuild/src/up-to-date.js';
import { inspectPublishProfile, createPublishProfileRequest } from '../packages/msbuild/src/publish-profiles.js';
import { parseSarif } from '../packages/msbuild/src/sarif.js';
import { DiagnosticCollector } from '../packages/msbuild/src/diagnostics.js';

const installed = ['8.0.100', '8.0.101', '8.0.200', '8.1.100', '9.0.100', '10.0.100-preview.1'].map(version => ({ version }));
for (const [version, rollForward, expected] of [
  ['8.0.100', 'disable', '8.0.100'], ['8.0.102', 'disable', null], ['8.0.100', 'patch', '8.0.100'],
  ['8.0.100', 'latestPatch', '8.0.101'], ['8.0.102', 'feature', '8.0.200'], ['8.0.100', 'latestFeature', '8.0.200'],
  ['8.0.300', 'minor', '8.1.100'], ['8.0.100', 'latestMinor', '8.1.100'], ['8.2.100', 'major', '9.0.100'],
  ['8.0.100', 'latestMajor', '10.0.100-preview.1'], ['11.0.100', 'major', null], ['9.0.100', 'feature', '9.0.100']
]) test('SDK resolution ' + version + '/' + rollForward, () => {
  assert.equal(resolveSdk({ sdk: { version, rollForward } }, installed).selected?.version ?? null, expected);
});
test('SDK discovery preserves paths, previews and host RID', () => {
  assert.deepEqual(parseSdkList('10.0.401 [/sdk]\n11.0.100-preview.1 [/preview]')[1], {
    version: '11.0.100-preview.1', path: '/preview/11.0.100-preview.1', basePath: '/preview', preview: true
  });
  assert.equal(parseRuntimeList('Microsoft.NETCore.App 10.0.5 [/runtime]')[0].name, 'Microsoft.NETCore.App');
  assert.equal(parseDotnetInfo(' RID: linux-x64\n Base Path: /sdk/10.0.401/').rid, 'linux-x64');
  assert.equal(resolveSdk({ sdk: { allowPrerelease: false } }, installed).selected.version, '9.0.100');
  const selected = resolveSdk({}, ['8.0.425', '10.0.201']).selected;
  assert.equal(selected.version, '10.0.201');
  assert.equal(Object.hasOwn(selected, '0'), false);
});
test('workload preflight identifies missing Android and host-specific Windows target restrictions', () => {
  const workloads = parseWorkloadList('Installed Workload Id    Manifest Version    Installation Source\n---------------------\nandroid                   35.0.7/10.0.100     SDK 10.0.100\n');
  assert.equal(workloads[0].id, 'android');
  assert.equal(explainTargetAvailability('net10.0-android', { workloads: [], sdkVersion: '10.0.401' }).code, 'NETSDK1147');
  assert.equal(explainTargetAvailability('net10.0-windows', { platform: 'linux', sdkVersion: '10.0.401' }).code, 'NETSDK1100');
});
test('project graph changes rebuild only the owning node and transitive dependents', () => {
  const graph = new ProjectBuildGraph([
    { id: 'shared', project: 'Shared.csproj', inputs: ['Shared.cs'], dependencies: [] },
    { id: 'app', project: 'App.csproj', inputs: ['Program.cs'], dependencies: ['shared'] },
    { id: 'other', project: 'Other.csproj', inputs: ['Other.cs'], dependencies: [] }
  ]);
  assert.deepEqual(graph.affected(['Program.cs']).map(node => node.id), ['app']);
  assert.deepEqual(graph.affected(['Shared.cs']).map(node => node.id), ['shared', 'app']);
  assert.throws(() => new ProjectBuildGraph([{ id: 'a', dependencies: ['b'] }, { id: 'b', dependencies: ['a'] }]), /cycle/);
});
test('fast up-to-date check detects input and output changes with an explanation', async () => {
  const files = new Map([['source', { modified: 1, hash: 'a' }], ['output', { modified: 2, hash: 'b' }]]);
  const checker = new FastUpToDateCheck({ fingerprint: async path => files.get(path) });
  const paths = { inputs: ['source'], outputs: ['output'] };
  assert.equal((await checker.check('A', paths)).upToDate, false);
  await checker.record('A', paths);
  assert.equal((await checker.check('A', paths)).upToDate, true);
  files.set('source', { modified: 3, hash: 'c' });
  assert.match((await checker.check('A', paths)).reason, /Changed input/);
});
test('publish profiles are inspectable without executing conditioned properties', () => {
  const profile = { name: 'Folder', ...inspectPublishProfile('<Project><PropertyGroup><PublishDir>publish/</PublishDir><PublishAot>true</PublishAot><RuntimeIdentifier Condition="x">linux-x64</RuntimeIdentifier></PropertyGroup></Project>', { path: 'Properties/PublishProfiles/Folder.pubxml' }) };
  assert.equal(profile.properties.PublishAot.value, 'true');
  assert.equal(profile.properties.RuntimeIdentifier.evaluated, false);
  assert.equal(createPublishProfileRequest({ project: 'App.csproj' }, profile).properties.PublishProfile, 'Folder');
});
test('SARIF preserves suppressed diagnostics, rule help and related locations', () => {
  const diagnostics = parseSarif({ version: '2.1.0', runs: [{ tool: { driver: { rules: [{ id: 'CS0168', helpUri: 'https://example.test/rule' }] } },
    results: [{ ruleId: 'CS0168', level: 'warning', message: { text: 'Unused variable' }, suppressions: [{ kind: 'inSource' }],
      locations: [{ physicalLocation: { artifactLocation: { uri: 'Program.cs' }, region: { startLine: 3, startColumn: 2 } } }],
      relatedLocations: [{ id: 1, message: { text: 'Related declaration' } }] }] }] });
  assert.equal(diagnostics[0].suppressed, true);
  assert.equal(diagnostics[0].helpUri, 'https://example.test/rule');
  assert.equal(diagnostics[0].relatedLocations.length, 1);
});
test('diagnostic stream preserves continuation text and removes summary duplicates', () => {
  const collector = new DiagnosticCollector();
  collector.accept('App.csproj : warning NU1605: Package downgrade [App.csproj]');
  collector.accept('    A -> B (>= 2.0)');
  collector.accept('App.csproj : warning NU1605: Package downgrade [App.csproj]');
  assert.equal(collector.diagnostics.length, 1);
  assert.deepEqual(collector.diagnostics[0].relatedMessages, ['A -> B (>= 2.0)']);
  collector.accept('NuGet.targets(12,3): error : Credentials item is incomplete [App.csproj]');
  assert.equal(collector.diagnostics[1].code, 'SFMSB_UNCODED');
  assert.equal(collector.diagnostics[1].line, 12);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNuGetVersion, compareNuGetVersions, satisfiesNuGetRange } from '../packages/msbuild/src/nuget/versioning.js';
import { parseNuGetConfiguration, sourcesForPackage } from '../packages/msbuild/src/nuget/config.js';
import { readProjectAssets } from '../packages/msbuild/src/nuget/assets.js';
import { readPackagesLock, writePackagesLock, detectLockDrift } from '../packages/msbuild/src/nuget/lock-file.js';
import { parseCentralPackages, resolveCentralPackages } from '../packages/msbuild/src/nuget/central-packages.js';
import { NuGetV3Client } from '../packages/msbuild/src/nuget/v3-client.js';
import { readNuGetPackage, selectPackageAssets } from '../packages/msbuild/src/nuget/package-reader.js';
import { writeZip } from '../packages/archive/src/index.js';

for (const [input, expected] of [['1', '1.0.0'], ['1.02', '1.2.0'], ['1.2.3.0', '1.2.3'],
  ['1.2.3.4', '1.2.3.4'], ['1.2.3-beta.2+commit', '1.2.3-beta.2']]) {
  test('NuGet version normalization ' + input, () => assert.equal(parseNuGetVersion(input).normalized, expected));
}
for (const [version, range, expected] of [['1.5', '[1.0,2.0)', true], ['2.0', '[1.0,2.0)', false], ['1.2', '[1.2]', true],
  ['1.2.1', '[1.2]', false], ['2.0', '1.0', true], ['1.9', '1.*', true], ['2.0', '1.*', false],
  ['1.2.0-alpha', '1.*', false], ['1.2.0-alpha', '1.2.0-*', true], ['1.2.0-beta.2', '1.2.0-beta.*', true]]) {
  test('NuGet range ' + version + ' in ' + range, () => assert.equal(satisfiesNuGetRange(version, range), expected));
}
test('NuGet SemVer ordering handles numeric labels, release precedence and case folding', () => {
  assert(compareNuGetVersions('1.0.0-beta.10', '1.0.0-beta.2') > 0);
  assert(compareNuGetVersions('1.0.0', '1.0.0-rc.1') > 0);
  assert.equal(compareNuGetVersions('1.0.0-BETA+one', '1.0.0-beta+two'), 0);
  assert.throws(() => parseNuGetVersion('1.2.2147483648'), /overflow/);
});
test('NuGet hierarchy applies clears, disabled feeds, source specificity, and never returns credentials', () => {
  const effective = parseNuGetConfiguration([
    { path: 'user', text: '<configuration><packageSources><add key="old" value="https://old.test/v3" /></packageSources></configuration>' },
    { path: 'project', text: '<configuration><packageSources><clear/><add key="public" value="https://feed.test/v3"/><add key="private" value="https://private.test/v3"/></packageSources><packageSourceCredentials><private><add key="ClearTextPassword" value="secret-never-return"/></private></packageSourceCredentials><packageSourceMapping><packageSource key="public"><package pattern="*"/></packageSource><packageSource key="private"><package pattern="Company.*"/></packageSource></packageSourceMapping></configuration>' }
  ]);
  assert.equal(effective.sources.length, 2);
  assert.equal(effective.sources[1].hasCredentials, true);
  assert(!JSON.stringify(effective).includes('secret-never-return'));
  assert.deepEqual(sourcesForPackage(effective, 'Company.Core').map(source => source.name), ['private']);
  assert.deepEqual(sourcesForPackage(effective, 'Other.Package').map(source => source.name), ['public']);
});
test('assets keep TFM/RID dependency identities and NU1605 restore errors', () => {
  const graph = readProjectAssets({ version: 3, targets: { 'net10.0/linux-x64': {
    'Direct/1.0.0': { type: 'package', dependencies: { Transitive: '2.0.0' }, compile: { 'ref/net10.0/Direct.dll': {} } },
    'Transitive/2.0.0': { type: 'package', runtime: { 'lib/net10.0/Transitive.dll': {} } }
  } }, libraries: { 'Direct/1.0.0': {}, 'Transitive/2.0.0': {} },
  project: { frameworks: { 'net10.0': { dependencies: { Direct: {} } } } },
  logs: [{ code: 'NU1605', level: 'Error', message: 'Detected package downgrade' }] });
  assert.equal(graph.frameworks[0].nodes[0].direct, true);
  assert.equal(graph.frameworks[0].nodes[1].transitive, true);
  assert.equal(graph.frameworks[0].runtimeIdentifier, 'linux-x64');
  assert.equal(graph.diagnostics[0].code, 'NU1605');
});
test('lock files round-trip unchanged formatting and report drift without rewriting input', () => {
  const text = '{ "version": 1, "dependencies": { "net10.0": { "A": { "type": "Direct", "requested": "[1.0.0,)", "resolved": "1.0.0" } } } }\r\n';
  const lock = readPackagesLock(text);
  assert.equal(writePackagesLock(lock), text);
  assert.equal(detectLockDrift(lock, { 'net10.0': [{ id: 'A', version: '[2.0.0,)' }] })[0].code, 'NU1004');
  assert.deepEqual(detectLockDrift(lock, { 'net10.0': [{ id: 'a', version: '[1.0.0,)' }] }), []);
});
test('central versions resolve overrides and reject absent declarations', () => {
  const central = parseCentralPackages('<Project><PropertyGroup><CentralPackageTransitivePinningEnabled>true</CentralPackageTransitivePinningEnabled></PropertyGroup><ItemGroup><PackageVersion Include="A" Version="1.0"/></ItemGroup></Project>');
  const result = resolveCentralPackages([{ id: 'A', versionOverride: '2.0' }, { id: 'Missing' }], central);
  assert.equal(result.references[0].version, '2.0');
  assert.equal(result.diagnostics[0].code, 'NU1010');
  assert.equal(result.transitivePinning, true);
  const global = resolveCentralPackages([], { globalPackageReferences: [{ id: 'Build.Tools', version: '1.2.3' }] });
  assert.deepEqual(global.diagnostics, []);
  assert.equal(global.references[0].version, '1.2.3');
  assert.equal(global.references[0].global, true);
});
test('V3 recorded protocol fixture covers service lookup, caching, versions and nuspec', async () => {
  const calls = [];
  const documents = {
    'https://feed.test/index.json': { version: '3.0.0', resources: [
      { '@type': 'SearchQueryService/3.0.0', '@id': 'https://feed.test/query' },
      { '@type': 'PackageBaseAddress/3.0.0', '@id': 'https://feed.test/flat/' }
    ] },
    'https://feed.test/flat/a/index.json': { versions: ['1.0.0', '2.0.0-beta'] },
    'https://feed.test/flat/a/1.0.0/a.nuspec': '<package><metadata><id>A</id></metadata></package>'
  };
  const client = new NuGetV3Client('https://feed.test/index.json', { fetch: async url => {
    calls.push(url);
    const value = documents[url] ?? { totalHits: 1, data: [{ id: 'A' }] };
    return new Response(typeof value === 'string' ? value : JSON.stringify(value));
  } });
  assert.equal((await client.search('A')).totalHits, 1);
  assert.deepEqual(await client.versions('A'), ['1.0.0', '2.0.0-beta']);
  assert.deepEqual(await client.versions('A'), ['1.0.0', '2.0.0-beta']);
  assert.equal(calls.filter(url => url.endsWith('/a/index.json')).length, 1);
  assert.match(await client.nuspec('A', '1.0'), /<id>A<\/id>/);
  await assert.rejects(() => client.fetchResource('https://evil.test/data'), /requires a grant/);
  assert.throws(() => new NuGetV3Client('https://feed.test/index.json', { credentials: () => ({}) }), /native host/);
});
test('V3 resource and cache budgets reject zero, overflow and non-integer limits before fetching', () => {
  for (const maxCacheEntries of [0, -1, 0.5, 1025, NaN]) {
    assert.throws(() => new NuGetV3Client('https://feed.test/index.json', { maxCacheEntries }), /cache entry limit/);
  }
  for (const maxBytes of [0, -1, 0.5, 268435457, NaN]) {
    assert.throws(() => new NuGetV3Client('https://feed.test/index.json', { maxBytes }), /byte limit/);
  }
});
test('nupkg selects ref compile assets independently from RID runtime and rejects invalid archives', () => {
  const archive = writeZip([
    { path: 'A.nuspec', text: '<package><metadata><id>A</id><version>1.0.0</version></metadata></package>' },
    { path: 'ref/net10.0/A.dll', bytes: Uint8Array.of(1) },
    { path: 'lib/net10.0/A.dll', bytes: Uint8Array.of(2) },
    { path: 'runtimes/linux-x64/lib/net10.0/A.dll', bytes: Uint8Array.of(3) },
    { path: 'runtimes/linux-x64/native/libA.so', bytes: Uint8Array.of(4) }
  ]);
  const packageData = readNuGetPackage(archive);
  const selected = selectPackageAssets(packageData, 'net10.0', { runtimeIdentifier: 'linux-x64',
    nearestFramework: (target, candidates) => candidates.includes(target) ? target : null });
  assert.deepEqual(selected.compile, ['ref/net10.0/A.dll']);
  assert.deepEqual(selected.runtime, ['runtimes/linux-x64/lib/net10.0/A.dll']);
  assert.equal(selected.native.length, 1);
  assert.throws(() => readNuGetPackage(Uint8Array.of(1, 2, 3)));
});

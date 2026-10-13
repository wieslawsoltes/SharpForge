import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNuGetVersion, compareNuGetVersions, satisfiesNuGetRange, parseNuGetConfiguration,
  sourcesForPackage, readProjectAssets, readPackagesLock, writePackagesLock, detectLockDrift,
  parseCentralPackages, resolveCentralPackages } from '@sharpforge/msbuild';

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
    { path: 'project', text: '<configuration><packageSources><clear/><add key="public" value="https://feed.test/v3"/>'
      + '<add key="private" value="https://private.test/v3"/></packageSources><packageSourceCredentials><private>'
      + '<add key="ClearTextPassword" value="secret-never-return"/></private></packageSourceCredentials><packageSourceMapping>'
      + '<packageSource key="public"><package pattern="*"/></packageSource><packageSource key="private">'
      + '<package pattern="Company.*"/></packageSource></packageSourceMapping></configuration>' }
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
  const text = '{ "version": 1, "dependencies": { "net10.0": { "A": { "type": "Direct", '
    + '"requested": "[1.0.0,)", "resolved": "1.0.0" } } } }\r\n';
  const lock = readPackagesLock(text);
  assert.equal(writePackagesLock(lock), text);
  assert.equal(detectLockDrift(lock, { 'net10.0': [{ id: 'A', version: '[2.0.0,)' }] })[0].code, 'NU1004');
  assert.deepEqual(detectLockDrift(lock, { 'net10.0': [{ id: 'a', version: '[1.0.0,)' }] }), []);
});
test('central versions resolve overrides and reject absent declarations', () => {
  const central = parseCentralPackages('<Project><PropertyGroup><CentralPackageTransitivePinningEnabled>true'
    + '</CentralPackageTransitivePinningEnabled></PropertyGroup><ItemGroup>'
    + '<PackageVersion Include="A" Version="1.0"/></ItemGroup></Project>');
  const result = resolveCentralPackages([{ id: 'A', versionOverride: '2.0' }, { id: 'Missing' }], central);
  assert.equal(result.references[0].version, '2.0');
  assert.equal(result.diagnostics[0].code, 'NU1010');
  assert.equal(result.transitivePinning, true);
  const global = resolveCentralPackages([], { globalPackageReferences: [{ id: 'Build.Tools', version: '1.2.3' }] });
  assert.deepEqual(global.diagnostics, []);
  assert.equal(global.references[0].version, '1.2.3');
  assert.equal(global.references[0].global, true);
});

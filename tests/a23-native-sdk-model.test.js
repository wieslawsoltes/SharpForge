import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSdkList, parseRuntimeList, parseDotnetInfo, resolveSdk } from '@sharpforge/msbuild/node';

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

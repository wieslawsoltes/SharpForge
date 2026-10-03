import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyLoadError, LoadErrorCode, nearestTargetFramework, selectNugetAssets, assetsFromProject } from '../packages/clr/src/index.js';

const hasCode = code => error => error instanceof AssemblyLoadError && error.code === code;

test('CLR NuGet assets select ref/lib/RID groups and reject traversal or unsupported frameworks', () => {
  const files = ['lib/netstandard2.0/Demo.dll', 'lib/net8.0/Demo.dll', 'ref/net8.0/Demo.dll',
    'runtimes/unix/lib/net8.0/Demo.dll'];
  assert.equal(nearestTargetFramework('net10.0', ['netstandard2.0', 'net8.0', 'net9.0']), 'net9.0');
  assert.equal(nearestTargetFramework('netstandard2.0', ['netstandard2.1']), null);
  assert.deepEqual(selectNugetAssets(files, { targetFramework: 'net10.0', kind: 'compile' }).paths, ['ref/net8.0/Demo.dll']);
  assert.deepEqual(selectNugetAssets(files, { targetFramework: 'net10.0', rid: 'osx', runtimeGraph: { osx: ['unix'] } }).paths,
    ['runtimes/unix/lib/net8.0/Demo.dll']);
  assert.throws(() => selectNugetAssets(['../Demo.dll'], { targetFramework: 'net10.0' }), hasCode(LoadErrorCode.InvalidConfiguration));
  assert.throws(() => nearestTargetFramework('net48', ['netstandard2.0']), hasCode(LoadErrorCode.UnsupportedFramework));
  const restored = { targets: { 'net10.0': { 'Demo/1.0': { runtime: { 'lib/net8.0/Demo.dll': {} } } } } };
  assert.deepEqual(assetsFromProject(restored, { targetFramework: 'net10.0' })[0].paths, ['lib/net8.0/Demo.dll']);
});

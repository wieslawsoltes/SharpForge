import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AssemblyName, AssemblyLoadError, LoadErrorCode, AssemblyProvider, AssemblyResolver,
  computePublicKeyToken, normalizeAssemblyIdentity, assemblyIdentityFromRow, compareAssemblyIdentity,
  readDependencyManifest, runtimeFallbacks, nearestTargetFramework, selectNugetAssets, assetsFromProject,
} from '../packages/clr/src/index.js';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/clr-identity/assembly-names.json', import.meta.url)));
const hasCode = code => error => error instanceof AssemblyLoadError && error.code === code;

test('CLR deps manifest selects RID assets and preserves explicit runtime configuration', () => {
  const deps = { runtimeTarget: { name: 'net10.0/osx-arm64' }, runtimes: { 'osx-arm64': ['osx', 'unix'], osx: ['unix'] },
    libraries: { 'Demo/1.0': { type: 'package', path: 'demo/1.0' } }, targets: { 'net10.0/osx-arm64': {
      'Demo/1.0': { runtime: { 'lib/net10.0/Demo.dll': {} }, runtimeTargets: {
        'runtimes/unix/lib/net10.0/Demo.dll': { rid: 'unix', assetType: 'runtime' },
        'runtimes/osx/lib/net10.0/Demo.dll': { rid: 'osx', assetType: 'runtime' },
      } },
    } } };
  const config = { runtimeOptions: { framework: { name: 'Microsoft.NETCore.App', version: '10.0.0' }, rollForward: 'LatestPatch' } };
  const result = readDependencyManifest(deps, config, { packageRoot: '/cache' });
  assert.equal(result.assemblies[0].path, '/cache/demo/1.0/runtimes/osx/lib/net10.0/Demo.dll');
  assert.equal(result.rollForward, 'LatestPatch');
  assert.deepEqual(result.fallbacks, ['osx-arm64', 'osx', 'unix']);
  assert.throws(() => runtimeFallbacks('a', { a: ['b'], b: ['a'] }), hasCode(LoadErrorCode.InvalidConfiguration));
  assert.throws(() => readDependencyManifest('{'), hasCode(LoadErrorCode.InvalidConfiguration));
  assert.throws(() => readDependencyManifest(deps, config, { signal: AbortSignal.abort() }), hasCode(LoadErrorCode.Cancelled));
});


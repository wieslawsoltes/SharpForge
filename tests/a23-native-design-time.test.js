import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesignTimeRequest, DesignTimeCache } from '@sharpforge/msbuild/node';

test('design-time requests avoid assembly emission and request semantic compiler inputs', () => {
  const request = createDesignTimeRequest({ project: 'App.csproj', trusted: true });
  assert.equal(request.properties.SkipCompilerExecution, 'true');
  assert.equal(request.properties.ProvideCommandLineArgs, 'true');
  assert(request.itemNames.includes('CscCommandLineArgs'));
  assert.equal(request.designTime, true);
});
test('shared import edits invalidate every cached project context', async () => {
  const fingerprints = new Map([['App.csproj', '1'], ['Lib.csproj', '1'], ['Directory.Build.props', '1']]);
  const cache = new DesignTimeCache({ fingerprint: async path => fingerprints.get(path) });
  await cache.set({ project: 'App.csproj' }, { sources: ['A.cs'] }, ['App.csproj', 'Directory.Build.props']);
  await cache.set({ project: 'Lib.csproj' }, { sources: ['B.cs'] }, ['Lib.csproj', 'Directory.Build.props']);
  assert.deepEqual(await cache.get({ project: 'App.csproj' }), { sources: ['A.cs'] });
  fingerprints.set('Directory.Build.props', '2');
  assert.equal(await cache.get({ project: 'App.csproj' }), null);
  assert.equal(await cache.get({ project: 'Lib.csproj' }), null);
});

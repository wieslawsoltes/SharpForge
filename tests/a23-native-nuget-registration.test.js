import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMSBuildHost } from '@sharpforge/msbuild/node';
import { MSBuildClient } from '@sharpforge/msbuild';

test('A23 native NuGet registration resolves paged metadata through the configured host feed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-native-registration-'));
  await writeFile(join(root, 'NuGet.Config'), '<configuration><packageSources><clear/>'
    + '<add key="public" value="https://feed.test/index.json"/></packageSources></configuration>');
  const documents = {
    'https://feed.test/index.json': { resources: [{ '@type': 'RegistrationsBaseUrl/3.6.0', '@id': 'https://feed.test/registration/' }] },
    'https://feed.test/registration/a/index.json': { items: [{ '@id': 'https://feed.test/pages/a.json' }] },
    'https://feed.test/pages/a.json': { items: [{ catalogEntry: { id: 'A', version: '1.0.0', listed: true } }] }
  };
  const calls = [];
  const host = await startMSBuildHost({ root, port: 0, nativeServices: { fetch: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert(Object.hasOwn(documents, url), url);
    return new Response(JSON.stringify(documents[url]));
  } } });
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  try {
    const request = { source: 'public', id: 'A' };
    const expected = [{ catalogEntry: { id: 'A', version: '1.0.0', listed: true } }];
    assert.deepEqual(await client.service('nuget', 'registration', request), expected);
    assert.deepEqual(await client.service('nuget', 'registration', request), expected);
    assert.equal(calls.length, 3);
    await assert.rejects(client.service('nuget', 'registration', { ...request, source: 'missing' }), /enabled configured NuGet source/);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { NuGetV3Client } from '@sharpforge/msbuild';

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

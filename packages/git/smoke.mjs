import assert from 'node:assert/strict';

/** Executed against the offline installed package, without workspace source paths. */
export async function smoke({ api, report }) {
  assert.equal(await api.hashObject('blob', new Uint8Array()), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  const service = api.createGitService();
  const identity = { name: 'Smoke', email: 'smoke@example.test', timestamp: 1700000000, timezone: '+0000' };
  try {
    await service.request('init');
    await service.request('writeFile', { path: 'hello.txt', data: new TextEncoder().encode('Hello from SharpForge Git\n') });
    await service.request('add', { path: 'hello.txt' });
    await service.request('commit', {
      message: 'Package smoke', author: identity, committer: identity
    });
    assert.equal((await service.request('log')).length, 1);
    assert.equal((await service.request('status')).length, 0);
    report.git = { backend: 'memory', hash: 'sha1dc', repositoryOperations: ['init', 'add', 'commit', 'log', 'status'] };
  } finally { await service.dispose(); }
}

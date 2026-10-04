import test from 'node:test';
import assert from 'node:assert/strict';
import { readZip } from '@sharpforge/archive';
import { openService, commitFiles, authorize, text, decode } from './git-adjuncts/fixture.js';

test('ZIP export uses the live credential redactor and retains executable modes after path and content sanitization', async t => {
  const { service, repo } = await openService(t);
  await authorize(service, { write: true });
  await commitFiles(repo, { 'fixture-access-token.sh': { data: 'echo fixture-access-token\n', mode: 0o100755 },
    'nested/readme.txt': 'plain\n' });
  const exported = await service.request('exportZip');
  const files = readZip(exported.bytes);
  const sanitized = files.find(file => file.path.endsWith('.sh'));
  assert.equal(sanitized.path, '[REDACTED].sh');
  assert.equal(decode(sanitized.bytes), 'echo [REDACTED]\n');
  assert.equal(JSON.stringify(exported.entries).includes('fixture-access-token'), false);
  const target = await openService(t);
  await target.repo.worktree.write('R.sh', 'unrelated untracked file\n');
  await target.service.request('importZip', { bytes: exported.bytes, stage: true });
  assert.equal(target.repo.index.get('[REDACTED].sh').mode, 0o100755);
  assert.equal(target.repo.index.get('R.sh'), null);
  assert.deepEqual((await target.repo.odb.read(target.repo.index.get('[REDACTED].sh').oid)).data, sanitized.bytes);
  await assert.rejects(service.request('exportBundle'), { code: 'Unsafe' });
});

test('ZIP export rejects a credential-bearing opaque binary instead of changing its bytes', async t => {
  const { service, repo } = await openService(t);
  await authorize(service, { write: true });
  const secret = text('fixture-access-token');
  const bytes = new Uint8Array(secret.length + 1);
  bytes[0] = 255;
  bytes.set(secret, 1);
  await commitFiles(repo, { 'opaque.bin': bytes });
  await assert.rejects(service.request('exportZip'), { code: 'Unsafe' });
});

test('service archive imports have a fixed 64 MiB bound and require byte arrays before parsing or effects', async t => {
  const { service, repo } = await openService(t);
  const oversized = new Uint8Array(64 * 1024 * 1024 + 1);
  const baseline = await repo.store.list('');
  for (const operation of ['importZip', 'importBundle']) {
    await assert.rejects(service.request(operation, { bytes: oversized, maxArchiveBytes: 512 * 1024 * 1024,
      maxBundleBytes: 512 * 1024 * 1024 }), { code: 'Limit' });
    await assert.rejects(service.request(operation, { bytes: new ArrayBuffer(0) }), { code: 'Corrupt' });
  }
  await assert.rejects(service.request('importZip', { bytes: oversized.subarray(0, 64 * 1024 * 1024) }), { code: 'Corrupt' });
  assert.deepEqual(await repo.store.list(''), baseline);
  assert.deepEqual(await repo.worktree.list(), []);
});

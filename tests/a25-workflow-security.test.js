import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCheckoutPath, validateCheckoutPaths, validateSymlinkTarget } from '../packages/git/src/path-safety.js';
import { GitExecutionPolicy } from '../packages/git/src/policy.js';
import { signSsh, verifySsh, signCommitPayload } from '../packages/git/src/sign.js';
import { encodeTree } from '../packages/git/src/objects.js';
import { repository, commitFile, identity } from './a25-workflow-fixtures.js';

test('portable checkout rejects traversal, metadata aliases, device paths and symlink escapes', () => {
  const invalid = ['../escape', '/absolute', 'a/../../b', 'C:/drive', '\\server\\file', '.git/config', '.GIT/hooks',
    'git~1/config', '.git~1/config', '.git\u200c/config', '.git::$INDEX_ALLOCATION', 'CON', 'NUL.txt',
    'a/COM1.log', 'a/LPT9', 'a/.', 'a//b', 'trailing.', 'trailing ', 'a\0b', 'a\u202eb'];
  for (const path of invalid) assert.throws(() => validateCheckoutPath(path), { code: 'Unsafe' }, path);
  assert.equal(validateCheckoutPath('src/文件.cs'), 'src/文件.cs');
  assert.throws(() => validateCheckoutPaths(['a', 'a/b']), { code: 'Unsafe' });
  assert.throws(() => validateCheckoutPaths(['A.cs', 'a.cs'], { caseSensitive: false }), { code: 'Unsafe' });
  assert.throws(() => validateSymlinkTarget('link', '../outside'), { code: 'Unsafe' });
  assert.throws(() => validateSymlinkTarget('a/link', '../../outside'), { code: 'Unsafe' });
  assert.equal(validateSymlinkTarget('a/link', '../inside'), '../inside');
});

test('malicious hooks, filters, aliases and fsmonitor are inert data with explicit policy notices', async () => {
  const notices = [];
  const repo = await repository({ policy: new GitExecutionPolicy({ notice: value => notices.push(value) }) });
  for (const [key, value] of [['core.hooksPath', '/tmp/hooks'], ['core.fsmonitor', 'touch /tmp/pwned'],
    ['alias.status', '!touch /tmp/pwned'], ['filter.evil.clean', 'touch /tmp/pwned']]) repo.config.set(key, value);
  await repo.config.save();
  await repo.worktree.write('.gitattributes', '*.txt filter=evil\n');
  await commitFile(repo, 'safe.txt', 'content');
  assert.ok(notices.some(value => value.setting === 'core.hooksPath'));
  assert.ok(notices.some(value => value.setting === 'core.fsmonitor'));
  assert.ok(notices.some(value => value.setting === 'alias.status'));
  assert.ok(notices.some(value => value.setting === 'filter.evil'));
  assert.equal(await repo.worktree.read('pwned'), null);
});

test('unsafe object paths are rejected before a checkout write and cancellation prevents mutation', async () => {
  const repo = await repository();
  const root = await commitFile(repo, 'safe', 'original');
  const blob = await repo.odb.write('blob', new TextEncoder().encode('bad'));
  const subtree = await repo.odb.write('tree', encodeTree([{ name: 'config', mode: 0o100644, oid: blob }]));
  const tree = await repo.odb.write('tree', encodeTree([{ name: '.git', mode: 0o40000, oid: subtree }]));
  const malicious = await repo.commit({ tree, parents: [root.oid], message: 'unsafe tree', author: identity, committer: identity });
  await repo.reset(root.oid, { mode: 'soft' });
  await assert.rejects(repo.checkout(malicious.oid), { code: 'Unsafe' });
  assert.deepEqual(await repo.worktree.list(), ['safe']);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(repo.add(['.'], { signal: controller.signal }), { code: 'Cancelled' });
  repo.dispose();
  await assert.rejects(repo.add(['.']), { code: 'Disposed' });
});

test('Ed25519 SSHSIG verifies contents and trust separately; OpenPGP requires a registered provider', async () => {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const data = new TextEncoder().encode('signed commit payload\n');
  const signature = await signSsh(data, keys);
  const checked = await verifySsh(data, signature);
  assert.equal(checked.valid, true);
  assert.equal(checked.trusted, null);
  assert.equal((await verifySsh(data, signature, { allowedKeys: [checked.publicKey] })).trusted, true);
  assert.equal((await verifySsh(new TextEncoder().encode('tampered'), signature)).valid, false);
  await assert.rejects(verifySsh(data, signature, { namespace: 'file' }), { code: 'Conflict' });
  await assert.rejects(signCommitPayload(data, { format: 'openpgp' }, new GitExecutionPolicy()), { code: 'Unsupported' });
});

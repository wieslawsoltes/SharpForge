import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { MemoryStore } from '../packages/git/src/memory-odb.js';
import { RefDatabase, isValidRefName, parsePackedRefs, serializePackedRefs } from '../packages/git/src/refs.js';

const first = '1'.repeat(40);
const second = '2'.repeat(40);
const third = '3'.repeat(40);
const identity = { name: 'Ref Test', email: 'refs@example.test', timestamp: 1700000000, timezone: '+0200' };
const bytes = text => new TextEncoder().encode(text);

test('reference names agree with native git check-ref-format', t => {
  const version = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) return t.skip('Native Git is unavailable on this platform');
  t.diagnostic(version.stdout.trim());
  const fixtures = ['refs/heads/main', 'refs/tags/v1.0', 'refs/remotes/origin/main', 'refs/heads/Żółć',
    'HEAD', '@', '/refs/heads/main', 'refs/heads/main/', 'refs//main', 'refs/heads/.hidden', 'refs/heads/foo.lock',
    'refs/heads/a..b', 'refs/heads/a@{b', 'refs/heads/a b', 'refs/heads/a~b', 'refs/heads/a^b', 'refs/heads/a:b',
    'refs/heads/a?b', 'refs/heads/a*b', 'refs/heads/a[b', 'refs/heads/a\\b', 'refs/heads/main.',
    'refs/heads/@', 'refs/heads/-leading', 'refs/heads/foo.lock/child', 'refs/heads/foo.LOCK', 'refs/heads/\u007f'];
  for (const name of fixtures) {
    assert.equal(isValidRefName(name), spawnSync('git', ['check-ref-format', name]).status === 0, name);
  }
  for (const name of ['HEAD', 'main', '@', 'a/b']) {
    assert.equal(isValidRefName(name, { allowOneLevel: true }),
      spawnSync('git', ['check-ref-format', '--allow-onelevel', name]).status === 0, name);
  }
});

test('symbolic references support unborn branches, CAS, detached HEAD and atomic reflogs', async () => {
  const refs = new RefDatabase({ clock: () => 1700000000 });
  await refs.setSymbolic('HEAD', 'refs/heads/main', { identity });
  assert.deepEqual(await refs.resolve('HEAD'), { ref: 'refs/heads/main', oid: null });
  await refs.update('HEAD', first, { expected: null, identity, message: 'commit: initial' });
  await assert.rejects(refs.update('HEAD', second, { expected: null, identity }), { code: 'Conflict' });
  assert.equal(await refs.read('HEAD'), first);
  assert.equal(await refs.read('HEAD', { deref: false }), 'refs/heads/main');
  await refs.update('HEAD', second, { deref: false, expected: 'refs/heads/main', identity, message: 'checkout: detach' });
  assert.deepEqual(await refs.resolve(), { ref: 'HEAD', oid: second });
  assert.equal(await refs.read('refs/heads/main'), first);
  await refs.setSymbolic('HEAD', 'refs/heads/main', { expected: second, identity, message: 'checkout: main' });
  const logs = await refs.reflog();
  assert.equal(logs.at(-2).oldOid, first);
  assert.equal(logs.at(-2).newOid, second);
  assert.equal(logs.at(-1).oldOid, second);
  assert.equal(logs.at(-1).newOid, first);
  assert.equal(logs.at(-1).identity.timestamp, identity.timestamp);
  await refs.update('HEAD', third, { identity: 'String Identity <string@example.test> 1700000001 +0000' });
  assert.equal((await refs.reflog()).at(-1).identity.name, 'String Identity');
});

test('packed references preserve peeled tags and loose overrides win until deletion', async () => {
  const entries = [{ name: 'refs/tags/v1', oid: first, peeled: second }, { name: 'refs/heads/main', oid: third }];
  const text = serializePackedRefs(entries);
  assert.deepEqual(parsePackedRefs(text), [entries[1], entries[0]]);
  const store = new MemoryStore();
  await store.set('packed-refs', bytes(text));
  const refs = new RefDatabase({ store });
  assert.equal(await refs.read('refs/tags/v1'), first);
  await refs.update('refs/tags/v1', third, { expected: first, identity });
  assert.equal(await refs.read('refs/tags/v1'), third);
  await refs.delete('refs/tags/v1', { expected: third, identity });
  assert.equal(await refs.read('refs/tags/v1'), null);
  assert.deepEqual((await refs.list()).map(entry => entry.name), ['refs/heads/main']);
  assert.throws(() => parsePackedRefs(`^${first}\n`), { code: 'Corrupt' });
  assert.throws(() => parsePackedRefs(`${first} refs/heads/main\n${second} refs/heads/main\n`), { code: 'Corrupt' });
});

test('multi-ref CAS checks all expectations before writes, including naming conflicts and cancellation', async () => {
  const refs = new RefDatabase();
  await refs.update('refs/heads/a', first, { identity });
  await refs.update('refs/heads/b', second, { identity });
  const before = await refs.reflog('refs/heads/a');
  await assert.rejects(refs.transaction([
    { name: 'refs/heads/a', oid: third, expected: first, identity },
    { name: 'refs/heads/b', oid: third, expected: first, identity }
  ]), { code: 'Conflict' });
  assert.equal(await refs.read('refs/heads/a'), first);
  assert.deepEqual(await refs.reflog('refs/heads/a'), before);
  await refs.update('refs/heads/a.sibling', first, { identity });
  await assert.rejects(refs.update('refs/heads/a/nested', first, { identity }), { code: 'Conflict' });
  await refs.transaction([{ name: 'refs/heads/a', oid: null, expected: first, identity },
    { name: 'refs/heads/renamed', oid: first, expected: null, identity }]);
  assert.equal(await refs.read('refs/heads/a'), null);
  assert.equal(await refs.read('refs/heads/renamed'), first);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(refs.update('refs/heads/b', third, { signal: controller.signal }), { code: 'Cancelled' });
});

test('symbolic cycles and malformed refs fail without modifying existing references', async () => {
  const refs = new RefDatabase();
  await refs.setSymbolic('HEAD', 'refs/heads/a');
  await assert.rejects(refs.setSymbolic('refs/heads/a', 'HEAD'), { code: 'Corrupt' });
  assert.equal(await refs.read('refs/heads/a'), null);
  await assert.rejects(refs.update('../outside', first), { code: 'Unsafe' });
  await refs.store.set('refs/heads/bad', bytes('not-an-object-id\n'));
  await assert.rejects(refs.read('refs/heads/bad'), { code: 'Corrupt' });
});

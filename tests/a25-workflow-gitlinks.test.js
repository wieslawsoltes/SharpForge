import test from 'node:test';
import assert from 'node:assert/strict';
import { repository, identity, fileText } from './a25-workflow-fixtures.js';
import { formatPorcelainV2 } from '../packages/git/src/status.js';

const firstPin = '1'.repeat(40);
const secondPin = '2'.repeat(40);

async function setPin(repo, oid) {
  const index = repo.index.clone();
  index.set({ path: 'deps/lib', mode: 0o160000, oid, stage: 0 });
  await repo.replaceIndex(index);
}

async function commitPin(repo, oid, message = 'Pin child') {
  await setPin(repo, oid);
  return repo.commit({ message, author: identity, committer: identity });
}

test('parent status, attributes and add treat indexed child contents as opaque', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  await commitPin(repo, firstPin);
  await repo.worktree.write('deps/lib/README.md', 'child worktree\n');
  await repo.worktree.write('deps/lib/.gitattributes', '* filter=untrusted text eol=crlf\n');
  await repo.worktree.write('deps/lib/.gitignore', '*\n');
  assert.deepEqual(await repo.status(), []);
  assert.equal(repo.attributes.get('deps/lib/README.md').filter, undefined);
  assert.equal(repo.ignore.test('deps/lib/README.md'), false);
  await repo.add(['.']);
  assert.deepEqual(repo.index.entries.map(entry => [entry.path, entry.mode, entry.oid]), [['deps/lib', 0o160000, firstPin]]);
  assert.deepEqual(await repo.status(), []);
  await assert.rejects(repo.add(['deps/lib/README.md']), { code: 'NotFound' });
  assert.equal(await fileText(repo, 'deps/lib/README.md'), 'child worktree\n');
});

test('local child inspection reports all porcelain submodule flags and stages only its HEAD pin', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  await commitPin(repo, firstPin);
  await repo.worktree.write('deps/lib/README.md', 'dirty child\n');
  const calls = [];
  let child = { initialized: true, oid: secondPin, modified: true, untracked: true };
  repo.setSubmoduleAdapter({ async state(path, options) { calls.push({ path, ...options }); return child; } });
  const [changed] = await repo.status();
  assert.equal(changed.path, 'deps/lib');
  assert.equal(changed.code, '.M');
  assert.equal(changed.submodule, 'SCMU');
  assert.equal(changed.worktreeOid, secondPin);
  assert.match(formatPorcelainV2([changed]), /^1 \.M SCMU 160000 160000 160000 /u);
  await repo.add(['deps/lib']);
  assert.equal(repo.index.get('deps/lib').oid, secondPin);
  assert.equal(repo.index.entries.length, 1);
  const [staged] = await repo.status();
  assert.equal(staged.code, 'MM');
  assert.equal(staged.submodule, 'S.MU');
  assert.ok(calls.every(call => call.path === 'deps/lib' && [firstPin, secondPin].includes(call.indexOid)));
  child = { initialized: false };
  await repo.add(['.']);
  assert.equal(repo.index.get('deps/lib').oid, secondPin);
  assert.equal((await repo.status())[0].code, 'M.');
});

test('unborn, malformed and cancelled child inspections preserve the parent index', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  await commitPin(repo, firstPin);
  repo.setSubmoduleAdapter({ async state() { return { initialized: true, oid: null }; } });
  await assert.rejects(repo.add(['.']), { code: 'Conflict' });
  assert.equal(repo.index.get('deps/lib').oid, firstPin);
  repo.setSubmoduleAdapter({ async state() { return { initialized: true, oid: '../bad' }; } });
  await assert.rejects(repo.status(), { code: 'Corrupt' });
  const controller = new AbortController();
  repo.setSubmoduleAdapter({ async state() { controller.abort(); return { initialized: true, oid: secondPin }; } });
  await assert.rejects(repo.add(['.'], { signal: controller.signal }), { code: 'Cancelled' });
  assert.equal(repo.index.get('deps/lib').oid, firstPin);
  assert.throws(() => repo.setSubmoduleAdapter({}), { code: 'Corrupt' });
});

test('switching parent pins or removing a gitlink preserves the child checkout', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  const first = await commitPin(repo, firstPin);
  const second = await commitPin(repo, secondPin);
  await repo.worktree.write('deps/lib/README.md', 'preserved child\n');
  await repo.checkout(first.oid);
  assert.equal(repo.index.get('deps/lib').oid, firstPin);
  assert.equal(await fileText(repo, 'deps/lib/README.md'), 'preserved child\n');
  await repo.checkout(second.oid);
  assert.equal(repo.index.get('deps/lib').oid, secondPin);
  await repo.remove(['deps/lib'], { cached: true });
  const removed = await repo.commit({ message: 'Remove parent gitlink', author: identity, committer: identity });
  await repo.checkout(second.oid);
  await repo.checkout(removed.oid);
  assert.equal(repo.index.get('deps/lib'), null);
  assert.equal(await fileText(repo, 'deps/lib/README.md'), 'preserved child\n');
});

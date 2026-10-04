import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitRepository } from '../packages/git/src/repository.js';
import { NodeWorktree } from '../packages/git/src/fs/node-worktree.js';
import { GitExecutionPolicy } from '../packages/git/src/policy.js';
import { hashObject } from '../packages/git/src/hash.js';
import { repository, commitFile } from './a25-workflow-fixtures.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function completion(kind, value) {
  if (kind === 'promise') return Promise.resolve(value);
  if (kind === 'thenable') return { then(resolve) { resolve(value); } };
  return value;
}

for (const kind of ['synchronous', 'promise', 'thenable']) {
  test(`status uses the same EOL and approved ${kind} filter semantics as staging`, async t => {
    const calls = [];
    const filter = { clean(bytes, { path }) {
      calls.push(path);
      return completion(kind, encoder.encode(decoder.decode(bytes).toUpperCase()));
    } };
    const repo = await repository({ policy: new GitExecutionPolicy({ filters: new Map([['fixture', filter]]) }) });
    t.after(() => repo.dispose());
    await repo.worktree.write('.gitattributes', '*.txt filter=fixture text eol=lf\n');
    await commitFile(repo, 'file.txt', 'before\r\n');
    calls.length = 0;
    repo.statCache.clear();
    assert.equal((await repo.status()).some(record => record.path === 'file.txt'), false);
    assert.deepEqual(calls, ['file.txt']);
    await repo.worktree.write('file.txt', 'changed\r\n');
    const change = (await repo.status()).find(record => record.path === 'file.txt');
    assert.equal(change.code, '.M');
    assert.equal(change.worktreeOid, await hashObject('blob', encoder.encode('CHANGED\n')));
    assert.deepEqual(await repo.clean('file.txt', encoder.encode('changed\r\n')), encoder.encode('CHANGED\n'));
  });

  test(`status honors a ${kind} per-operation LFS cleaner before the repository default`, async t => {
    let defaults = 0;
    const repo = await repository({ lfs: { clean() { defaults++; return { data: encoder.encode('default pointer\n') }; } } });
    t.after(() => repo.dispose());
    await repo.worktree.write('.gitattributes', '*.bin filter=lfs -text\n');
    await commitFile(repo, 'file.bin', 'binary bytes');
    const previousCalls = defaults;
    const data = encoder.encode('override pointer\n');
    const lfs = { clean() { return completion(kind, { data }); } };
    repo.statCache.clear();
    const change = (await repo.status({ lfs })).find(record => record.path === 'file.bin');
    assert.equal(change.worktreeOid, await hashObject('blob', data));
    assert.deepEqual(await repo.clean('file.bin', encoder.encode('binary bytes'), { lfs }), data);
    assert.equal(defaults, previousCalls);
  });
}

for (const kind of ['subclass', 'instance']) {
  test(`status honors a ${kind} override of public clean`, async t => {
    const calls = [];
    class CustomRepository extends GitRepository {
      async clean(path, bytes, options) {
        calls.push(path);
        const transformed = path.endsWith('.txt') ? encoder.encode(decoder.decode(bytes).toUpperCase()) : bytes;
        return super.clean(path, transformed, options);
      }
    }
    const repo = kind === 'subclass' ? new CustomRepository() : new GitRepository();
    if (kind === 'instance') {
      const original = repo.clean.bind(repo);
      repo.clean = async (path, bytes, options) => {
        calls.push(path);
        return original(path, encoder.encode(decoder.decode(bytes).toUpperCase()), options);
      };
    }
    await repo.init();
    t.after(() => repo.dispose());
    await commitFile(repo, 'file.txt', 'before\n');
    calls.length = 0;
    await repo.worktree.write('file.txt', 'changed\n');
    const change = (await repo.status())[0];
    assert.equal(change.worktreeOid, await hashObject('blob', encoder.encode('CHANGED\n')));
    assert.deepEqual(calls, ['file.txt']);
  });
}

test('safecrlf errors reject both public clean and status with the same conflict code', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  repo.config.set('core.autocrlf', true).set('core.safecrlf', true);
  await repo.worktree.write('file.txt', 'lf only\n');
  const cleaned = repo.clean('file.txt', encoder.encode('lf only\n'));
  assert.equal(typeof cleaned.then, 'function');
  await assert.rejects(cleaned, { code: 'Conflict' });
  await assert.rejects(repo.status(), { code: 'Conflict' });
});

test('aborting an asynchronous cleaner stops before the next record in a verified Node batch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-status-clean-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  const calls = [];
  const filter = { async clean(bytes, { path }) {
    calls.push(path);
    controller.abort();
    return bytes;
  } };
  const repo = await repository({ worktree: new NodeWorktree(directory),
    policy: new GitExecutionPolicy({ filters: new Map([['cancel', filter]]) }) });
  t.after(() => repo.dispose());
  await repo.worktree.write('.gitattributes', encoder.encode('*.txt filter=cancel\n'));
  await repo.worktree.write('a.txt', encoder.encode('first\n'));
  await repo.worktree.write('b.txt', encoder.encode('second\n'));
  await assert.rejects(repo.status({ signal: controller.signal }), { code: 'Cancelled' });
  assert.deepEqual(calls, ['a.txt']);
  assert.equal(repo.statCache.has('a.txt'), false);
});

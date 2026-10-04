import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MemoryStore } from '../packages/git/src/memory-odb.js';
import { RefDatabase } from '../packages/git/src/refs.js';
import { decodeIndex } from '../packages/git/src/index-file.js';
import { parseReflog } from '../packages/git/src/refs/reflog.js';
import { identity } from './a25-workflow-fixtures.js';
import { nativeWorkspace, mergeFixture, indexRecords, nativeIndexRecords, worktreeRecords } from './a25-conformance-local-fixtures.js';

const identityEnvironment = {
  GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_AUTHOR_DATE: `${identity.timestamp} ${identity.timezone}`,
  GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email, GIT_COMMITTER_DATE: `${identity.timestamp} ${identity.timezone}`
};

export async function workflowFixture(t, name, sides) {
  const workspace = await nativeWorkspace(t);
  if (!workspace) return null;
  const store = new MemoryStore();
  const refs = new RefDatabase({ store, clock: () => identity.timestamp });
  const pair = await mergeFixture(workspace, name, sides, { repositoryOptions: { store, refs } });
  t.after(() => pair.repo.dispose());
  const native = pair.git;
  return { ...pair, workspace,
    git: (args, options = {}) => native(args, { ...options, env: { ...identityEnvironment, ...options.env } }),
    async write(path, text) {
      await workspace.write(pair.directory, path, text);
      await pair.repo.worktree.write(path, text);
    },
    async remove(path) { await pair.nativeWorktree.remove(path); await pair.repo.worktree.remove(path); }
  };
}

/** Native commands supply the reference index; compare every semantic flag and exact mode/OID/stage. */
export async function compareWorkflowIndex(pair, label, { head = true, worktree = true } = {}) {
  const { repo, git, directory } = pair;
  const native = await git(['ls-files', '--stage', '-z']);
  assert.deepEqual(indexRecords(repo.index), nativeIndexRecords(native.stdout), `${label}: index entries`);
  const decoded = await decodeIndex(new Uint8Array(await readFile(join(directory, '.git', 'index'))));
  const flags = index => index.entries.map(entry => ({ path: entry.path, stage: entry.stage,
    intentToAdd: !!entry.intentToAdd, skipWorktree: !!entry.skipWorktree, assumeValid: !!entry.assumeValid }));
  assert.deepEqual(flags(repo.index), flags(decoded), `${label}: index flags`);
  if (head) assert.equal(await repo.refs.read('HEAD'), (await git(['rev-parse', 'HEAD'])).text, `${label}: HEAD`);
  if (worktree) assert.deepEqual(await worktreeRecords(repo.worktree), await worktreeRecords(pair.nativeWorktree), `${label}: worktree`);
}

export async function compareWorkflowRefs(pair, label) {
  const native = (await pair.git(['for-each-ref', '--format=%(refname) %(objectname)'])).text;
  const actual = (await pair.repo.refs.list()).map(ref => `${ref.name} ${ref.oid}`).join('\n');
  assert.equal(actual, native, `${label}: refs`);
}

export async function compareWorkflowReflog(pair, name, label) {
  let bytes;
  try { bytes = await readFile(join(pair.directory, '.git', 'logs', ...name.split('/'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const actual = await pair.repo.store.get(`logs/${name}`);
  assert.equal(actual !== undefined, bytes !== undefined, `${label}: reflog existence`);
  assert.deepEqual(await pair.repo.refs.reflog(name), parseReflog(bytes?.toString('utf8') ?? ''), `${label}: reflog entries`);
}

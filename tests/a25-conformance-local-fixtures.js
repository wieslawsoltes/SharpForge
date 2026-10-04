import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GitIndex } from '../packages/git/src/index-file.js';
import { encodeCommit, encodeTree } from '../packages/git/src/objects.js';
import { NodeWorktree } from '../packages/git/src/fs/node-worktree.js';
import { repository, identity } from './a25-workflow-fixtures.js';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';

export async function nativeWorkspace(t) {
  const available = await gitAvailability();
  if (!available.available) { t.skip(available.reason); return null; }
  t.diagnostic(available.version);
  const workspace = await fixtureWorkspace('sharpforge-local-conformance-');
  t.after(() => workspace.dispose());
  return workspace;
}

export async function fileTree(repo, files) {
  const index = new GitIndex();
  for (const [path, value] of Object.entries(files)) {
    const record = typeof value === 'string' || value instanceof Uint8Array ? { data: value } : value;
    const data = typeof record.data === 'string' ? new TextEncoder().encode(record.data) : record.data;
    const oid = record.oid ?? await repo.odb.write('blob', data);
    index.set({ path, oid, mode: record.mode ?? 0o100644 });
  }
  return { index, oid: await objectTree(repo, index) };
}

async function objectTree(repo, index) {
  const directories = new Map([['', []]]);
  for (const entry of index.entries) {
    const components = entry.path.split('/');
    const name = components.pop();
    let prefix = '';
    for (const component of components) {
      const child = prefix ? `${prefix}/${component}` : component;
      if (!directories.has(child)) {
        directories.set(child, []);
        directories.get(prefix).push({ name: component, mode: 0o40000, child });
      }
      prefix = child;
    }
    directories.get(prefix).push({ name, oid: entry.oid, mode: entry.mode });
  }
  const ids = new Map();
  for (const path of [...directories.keys()].sort((left, right) => right.length - left.length)) {
    const entries = directories.get(path).map(entry => entry.child ? { ...entry, oid: ids.get(entry.child) } : entry);
    ids.set(path, await repo.odb.write('tree', encodeTree(entries)));
  }
  return ids.get('');
}

export async function commitObject(repo, tree, parents, message) {
  return repo.odb.write('commit', encodeCommit({ tree, parents, author: identity, committer: identity, message: `${message}\n` }));
}

export async function copyObjects(repo, git) {
  for (const oid of await repo.odb.list()) {
    const object = await repo.odb.read(oid);
    const copied = (await git(['hash-object', '-w', '-t', object.type, '--stdin'], { input: object.data })).text;
    if (copied !== oid) throw new Error(`Native object hash differs for ${oid}`);
  }
}

/** Both implementations start with identical commit, index and working-file bytes. */
export async function mergeFixture(workspace, name, { base, ours, theirs }, { repositoryOptions } = {}) {
  const directory = join(workspace.root, name);
  await mkdir(directory);
  const git = (args, options) => workspace.git(args, { cwd: directory, ...options });
  await git(['init', '-q', '-b', 'main']);
  const repo = await repository(repositoryOptions);
  const baseTree = await fileTree(repo, base);
  const oursTree = await fileTree(repo, ours);
  const theirsTree = await fileTree(repo, theirs);
  const ancestor = await commitObject(repo, baseTree.oid, [], 'base');
  const left = await commitObject(repo, oursTree.oid, [ancestor], 'ours');
  const right = await commitObject(repo, theirsTree.oid, [ancestor], 'theirs');
  await copyObjects(repo, git);
  await git(['update-ref', 'refs/heads/main', left]);
  await git(['update-ref', 'refs/heads/topic', right]);
  await git(['read-tree', '--reset', '-u', left]);
  await repo.refs.update('refs/heads/main', left, { expected: null });
  await repo.refs.update('refs/heads/topic', right, { expected: null });
  await repo.replaceIndex(oursTree.index);
  for (const entry of oursTree.index.entries) {
    if (entry.mode !== 0o160000) await repo.worktree.write(entry.path, (await repo.odb.read(entry.oid)).data, { mode: entry.mode });
  }
  return { repo, git, directory, ours: left, theirs: right, nativeWorktree: new NodeWorktree(directory) };
}

export function indexRecords(index) {
  return index.entries.map(entry => ({ path: entry.path, stage: entry.stage, mode: entry.mode.toString(8), oid: entry.oid }));
}

export function nativeIndexRecords(bytes) {
  return bytes.toString('utf8').split('\0').filter(Boolean).map(record => {
    const matched = /^(\d+) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/u.exec(record);
    if (!matched) throw new Error('Malformed native index record');
    return { path: matched[4], stage: Number(matched[3]), mode: matched[1], oid: matched[2] };
  });
}

export async function worktreeRecords(tree) {
  const records = [];
  for (const path of await tree.list()) {
    const file = await tree.read(path);
    if (file) records.push({ path, mode: file.mode, data: [...file.data] });
  }
  return records;
}

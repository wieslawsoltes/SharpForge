import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpGitTransport } from '../../packages/git/src/index.js';
import { startGitHttpFixture } from '../../packages/git/bench/git-http-fixture.js';

/** A real native HTTP remote with divergent branches, tags, a merge and disconnected history. */
export async function createFetchFixture(workspace, { name = 'repository', protocolVersion = 2 } = {}) {
  const directory = join(workspace.root, name + '-seed');
  const bare = join(workspace.root, name + '.git');
  await mkdir(directory);
  const git = (args, options = {}) => workspace.git(args, { cwd: directory, ...options });
  const remoteGit = (args, options = {}) => workspace.git(args, { cwd: bare, ...options });
  const write = (path, text) => workspace.write(directory, path, text);
  const commit = async (message, sequence) => {
    await git(['add', '-A']);
    const date = `${1700000000 + sequence * 60} +0000`;
    await git(['commit', '-q', '-m', message], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    return (await git(['rev-parse', 'HEAD'])).text;
  };
  await git(['init', '-q', '--initial-branch=main']);
  await write('tracked.txt', 'base\n');
  await write('nested/binary.bin', Uint8Array.of(0, 255, 7, 128, 0));
  const base = await commit('base', 0);
  await git(['branch', 'side', base]);
  await write('tracked.txt', 'main one\n');
  await commit('main one', 1);
  await write('main.txt', 'main two\n');
  const main = await commit('main two', 2);
  await git(['branch', 'release/v1', main]);
  await git(['branch', 'private/secret', base]);
  await git(['tag', 'lightweight', base]);
  await git(['tag', '-a', 'v1', '-m', 'annotated native fixture', main]);
  await git(['switch', '-q', 'side']);
  await write('side.txt', 'side one\n');
  await commit('side one', 3);
  await write('side.txt', 'side two\n');
  const side = await commit('side two', 4);
  await git(['switch', '-q', 'main']);
  const tree = (await git(['rev-parse', 'HEAD^{tree}'])).text;
  const merged = (await git(['commit-tree', tree, '-p', main, '-p', side, '-m', 'merge both histories'])).text;
  const unrelated = (await git(['commit-tree', tree, '-m', 'disconnected root'])).text;
  await git(['branch', 'merged', merged]);
  await git(['branch', 'unrelated', unrelated]);
  await workspace.git(['clone', '-q', '--bare', directory, bare]);
  await remoteGit(['config', 'http.receivepack', 'true']);
  const server = await startGitHttpFixture({ directory: workspace.root, env: workspace.env, protocolVersion });
  return { directory, bare, git, remoteGit, write, commit, base, main, side, merged, unrelated,
    server, url: `${server.origin}/${name}.git` };
}

/** Record bounded request metadata while retaining actual native HTTP I/O and response bodies. */
export function observedTransport(origin) {
  const requests = [];
  const transport = new HttpGitTransport({ origins: [origin], allowInsecureLocalhost: true, fetch: (url, options) => {
    assert.ok(requests.length < 256, 'Fixture request observation bound');
    requests.push({ url, method: options.method, protocol: options.headers.get('git-protocol'),
      body: options.body ? new TextDecoder().decode(options.body) : '' });
    return fetch(url, options);
  } });
  return { transport, requests };
}

export async function nativeRefs(git) {
  const result = await git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)']);
  return result.text.split('\n').filter(Boolean).map(line => {
    const [name, oid, symbolic] = line.split('\0');
    return { name, oid, symbolic: symbolic || null };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export async function sharpRefs(repository) {
  return (await repository.refs.list()).map(({ name, oid, symbolic }) => ({ name, oid, symbolic: symbolic ?? null }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function nativeObjectIds(git, revisions = ['--all']) {
  const result = await git(['rev-list', '--objects', '--no-object-names', ...revisions]);
  return [...new Set(result.text.split('\n').filter(Boolean))].sort();
}

/** Native cat-file supplies type and raw bytes, including binary trees/blobs and annotated tags. */
export async function assertNativeObjects(repository, git) {
  const ids = await nativeObjectIds(git);
  assert.deepEqual((await repository.odb.list()).sort(), ids);
  const output = (await git(['cat-file', '--batch'], { input: ids.join('\n') + '\n' })).stdout;
  let cursor = 0;
  for (const oid of ids) {
    const end = output.indexOf(10, cursor);
    assert.ok(end >= cursor, 'Native cat-file header is present');
    const [actualId, type, sizeText] = output.subarray(cursor, end).toString().split(' ');
    const size = Number(sizeText);
    assert.equal(actualId, oid);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    const object = await repository.odb.read(oid);
    assert.equal(object.type, type);
    assert.deepEqual(Buffer.from(object.data), output.subarray(end + 1, end + 1 + size), `${oid}: native bytes`);
    cursor = end + size + 2;
  }
  assert.equal(cursor, output.length);
  return ids;
}

/** Normalize only Git's documented short display names in its dry-run arrow rows. */
export function nativeDryRunRows(result) {
  return result.stderr.toString().split('\n').flatMap(line => {
    const row = /\s(\S+)\s+->\s+(\S+)(?:\s|$)/.exec(line);
    return row ? [`${row[1]} -> ${row[2]}`] : [];
  }).sort();
}

export function shortRef(name) {
  return name?.replace(/^refs\/(?:heads|tags|remotes)\//, '') ?? 'FETCH_HEAD';
}

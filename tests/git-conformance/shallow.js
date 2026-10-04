import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitError, GitRepository, cloneRepository, createHttpTransport, fetchRemote, parseShallow } from '@sharpforge/git';
import { initNodeRepository } from '@sharpforge/git/node';
import { startGitHttpFixture } from '../../packages/git/bench/git-http-fixture.js';
import { fixtureWorkspace } from './native.js';

const HISTORY_LENGTH = 20;
const stages = Object.freeze([
  { name: 'relative deepen 10', native: '--deepen=10', options: { depth: 10, relative: true }, count: 11 },
  { name: 'absolute deepen', native: '--depth=16', options: { depth: 16 }, count: 16 },
  { name: 'absolute shorten', native: '--depth=4', options: { depth: 4 }, count: 4, retainBoundaries: true },
  { name: 'unshallow', native: '--unshallow', options: { unshallow: true }, count: HISTORY_LENGTH }
]);

async function createHistory(workspace, algorithm) {
  const seed = join(workspace.root, 'seed');
  await mkdir(seed);
  await workspace.git(['init', '-q', '--initial-branch=main', `--object-format=${algorithm}`], { cwd: seed });
  for (let index = 0; index < HISTORY_LENGTH; index++) {
    await workspace.write(seed, 'history.txt', `revision ${index}\n`);
    await workspace.write(seed, `files/file-${index}.txt`, `retained file ${index}\n`);
    await workspace.git(['add', '-A'], { cwd: seed });
    const date = `${1700000000 + index * 86400} +0000`;
    await workspace.git(['commit', '-q', '-m', `linear commit ${index}`], {
      cwd: seed, env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
    });
  }
  await workspace.git(['clone', '-q', '--bare', seed, 'repository.git']);
}

async function shallowFile(directory) {
  try { return await readFile(join(directory, '.git', 'shallow')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function sortedLines(text) { return text.split('\n').filter(Boolean).sort(); }

async function comparePublicHistory(fixture, report, stage) {
  const { workspace, native, repo, algorithm } = fixture;
  const label = `${algorithm} ${stage.name}`;
  const expected = (await workspace.git(['log', '--format=%H'], { cwd: native })).text.split('\n');
  report.equal('shallow-api-history', label, (await repo.log({ maxCount: HISTORY_LENGTH + 1 })).map(commit => commit.oid), expected);
  const expression = `HEAD~${stage.count - 1}`;
  report.equal('shallow-revision', `${label} last visible ancestor`, await repo.revParse(expression),
    (await workspace.git(['rev-parse', expression], { cwd: native })).text);
  const failure = await repo.revParse(`HEAD~${stage.count}`).then(() => null, error => {
    if (!(error instanceof GitError)) throw error;
    return error.code;
  });
  report.equal('shallow-revision', `${label} boundary rejects parent traversal`, failure, 'NotFound');
  if (stage.count < HISTORY_LENGTH) {
    const boundary = await repo.readCommit(expected.at(-1));
    report.equal('shallow-canonical', `${label} canonical bytes retain the actual parent`, boundary.parents.length, 1);
  }
}

async function compareBoundary(fixture, report, stage) {
  const { workspace, native, sharp, repo, algorithm } = fixture;
  const label = `${algorithm} ${stage.name}`;
  const nativeBoundary = [...parseShallow(await shallowFile(native), { algorithm })].sort();
  const sharpBoundary = [...parseShallow(await repo.store.get('shallow'), { algorithm })].sort();
  // Shortening adds the new visible boundary while retaining the earlier, now-unreachable
  // shallow commit. Assert exact identities from the complete native history, not a presumed
  // one-line shallow file or a permissive minimum count. Unshallow must remove both entries.
  const expectedBoundary = stage.count === HISTORY_LENGTH ? [] : [
    ...(stage.retainBoundaries ? fixture.previousBoundary : []), fixture.fullHistory[stage.count - 1]
  ].sort();
  report.equal('shallow-boundary', `${label} native boundary identities`, nativeBoundary, expectedBoundary);
  report.equal('shallow-boundary', label, sharpBoundary, nativeBoundary);
  for (const args of [['rev-parse', 'HEAD'], ['rev-list', '--topo-order', 'HEAD'], ['ls-files', '--stage', '-z']]) {
    const actual = await workspace.git(args, { cwd: sharp });
    const expected = await workspace.git(args, { cwd: native });
    report.equal('shallow-state', `${label} ${args[0]}`, actual.stdout, expected.stdout);
  }
  report.equal('shallow-history', `${label} visible commit count`,
    Number((await workspace.git(['rev-list', '--count', 'HEAD'], { cwd: sharp })).text), stage.count);
  await comparePublicHistory(fixture, report, stage);
  const nativeObjects = await workspace.git(['rev-list', '--objects', '--no-object-names', 'HEAD'], { cwd: native });
  const sharpObjects = await workspace.git(['rev-list', '--objects', '--no-object-names', 'HEAD'], { cwd: sharp });
  report.equal('shallow-objects', label, sortedLines(sharpObjects.text), sortedLines(nativeObjects.text));
  report.equal('shallow-worktree', label, await readFile(join(sharp, 'history.txt')), await readFile(join(native, 'history.txt')));
  for (const directory of [native, sharp]) {
    const fsck = await workspace.git(['fsck', '--strict', '--full'], { cwd: directory, allowFailure: true });
    report.equal('shallow-fsck', `${label} ${directory === sharp ? 'SharpForge' : 'native'}`, fsck.code, 0);
  }
  if (stage.count === HISTORY_LENGTH) {
    report.equal('shallow-boundary', `${label} removes shallow metadata`, await shallowFile(sharp), null);
    const full = await workspace.git(['rev-list', '--objects', '--no-object-names', 'HEAD'], { cwd: join(workspace.root, 'full') });
    report.equal('shallow-full-clone', label, sortedLines(sharpObjects.text), sortedLines(full.text));
  }
  fixture.previousBoundary = nativeBoundary;
}

/** Compare real HTTP shallow state with native Git after each depth transition, in one isolated object format. */
export async function runShallowConformance(report, algorithm) {
  const workspace = await fixtureWorkspace(`sharpforge-shallow-${algorithm}-`);
  let server;
  let descriptor;
  let repo;
  try {
    await createHistory(workspace, algorithm);
    server = await startGitHttpFixture({ directory: workspace.root, env: workspace.env });
    const native = join(workspace.root, 'native');
    const sharp = join(workspace.root, 'sharp');
    const url = `${server.origin}/repository.git`;
    await workspace.git(['-c', 'protocol.version=2', 'clone', '-q', '--no-tags', url, 'full']);
    await workspace.git(['-c', 'protocol.version=2', 'clone', '-q', '--depth=1', '--no-tags', url, native]);
    descriptor = await initNodeRepository({ directory: sharp, algorithm });
    repo = new GitRepository(descriptor);
    await repo.init();
    const transport = createHttpTransport({ origins: [server.origin], allowInsecureLocalhost: true });
    const options = { odb: repo.odb, refs: repo.refs, config: repo.config, worktree: repo.worktree,
      algorithm, url, transport, tags: 'none' };
    await cloneRepository({ ...options, depth: 1, checkout: ({ oid }) => repo.checkout(oid, { force: true }) });
    const fullHistory = (await workspace.git(['rev-list', 'HEAD'], { cwd: join(workspace.root, 'full') })).text.split('\n');
    report.equal('shallow-reference', `${algorithm} complete native fixture length`, fullHistory.length, HISTORY_LENGTH);
    const fixture = { workspace, native, sharp, repo, algorithm, fullHistory, previousBoundary: [] };
    await compareBoundary(fixture, report, { name: 'clone depth 1', count: 1 });
    for (const stage of stages) {
      await workspace.git(['-c', 'protocol.version=2', 'fetch', '-q', '--no-tags', stage.native, 'origin'], { cwd: native });
      const fetched = await fetchRemote({ ...options, ...stage.options });
      report.equal('shallow-fetch', `${algorithm} ${stage.name} receives verified pack`, fetched.pack !== null, true);
      await compareBoundary(fixture, report, stage);
    }
  } finally {
    repo?.dispose();
    await descriptor?.store.close();
    await server?.close();
    await workspace.dispose();
  }
}

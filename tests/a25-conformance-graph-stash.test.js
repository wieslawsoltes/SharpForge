import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CommitGraph, GitRepository } from '../packages/git/src/index.js';
import { openNodeRepository } from '../packages/git/src/fs/node.js';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';

const identity = Object.freeze({ name: 'Fixture Author', email: 'author@example.test', timestamp: 1700000500, timezone: '+0000' });

function graphFamilies(depth) {
  const linear = Array.from({ length: 4 + depth * 2 }, (_, index) => index ? [index - 1] : []);
  const split = depth + 2;
  const disconnected = Array.from({ length: split * 2 }, (_, index) => index % split ? [index - 1] : []);
  const fork = Array.from({ length: 3 + depth * 2 }, (_, index) => index ? [Math.max(0, index - 2)] : []);
  const diamonds = [[]];
  let tip = 0;
  for (let index = 0; index < depth; index++) {
    const left = diamonds.push([tip]) - 1;
    const right = diamonds.push([tip]) - 1;
    tip = diamonds.push([left, right]) - 1;
  }
  diamonds.push([tip], [tip]);
  const crissCross = [[], [0], [0]];
  let left = 1;
  let right = 2;
  for (let index = 0; index < depth; index++) {
    const next = crissCross.length;
    crissCross.push([left, right], [right, left]);
    left = next;
    right = next + 1;
  }
  const octopus = [[], ...Array.from({ length: depth + 2 }, () => [0])];
  const arms = octopus.slice(1).map((_, index) => index + 1);
  octopus.push(arms, [...arms].reverse());
  const ladder = [[], [0], [0]];
  left = 1;
  right = 2;
  for (let index = 0; index < depth; index++) {
    const side = ladder.push([right]) - 1;
    const main = ladder.push([left, side]) - 1;
    right = ladder.push([right, left]) - 1;
    left = main;
  }
  let seed = (0xa250000 + depth) >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const dag = [[], [0]];
  for (let index = 2; index < 10 + depth * 2; index++) {
    const parents = new Set();
    const count = Math.min(index, random() % 4);
    while (parents.size < count) parents.add(random() % index);
    dag.push([...parents]);
  }
  const last = nodes => [nodes.length - 2, nodes.length - 1];
  return [
    { name: 'linear', nodes: linear, tips: [linear.length - 1, depth] },
    { name: 'disconnected', nodes: disconnected, tips: [split - 1, disconnected.length - 1] },
    { name: 'fork', nodes: fork, tips: last(fork) },
    { name: 'diamonds', nodes: diamonds, tips: last(diamonds) },
    { name: 'criss-cross', nodes: crissCross, tips: last(crissCross) },
    { name: 'octopus', nodes: octopus, tips: last(octopus) },
    { name: 'ladder', nodes: ladder, tips: [left, right] },
    { name: 'seeded-dag', nodes: dag, tips: last(dag) }
  ].map(shape => ({ ...shape, name: `${shape.name}-${depth}` }));
}

async function materializeGraph(workspace, shape, emptyTree, sequence) {
  const oids = [];
  for (const [index, parents] of shape.nodes.entries()) {
    const date = `${1700000000 + sequence * 1000 + index * 13 + (index % 3 === 0 ? 97 : 0)} +0000`;
    const args = ['commit-tree', emptyTree, ...parents.flatMap(parent => ['-p', oids[parent]]), '-m', `${shape.name} node ${index}`];
    oids.push((await workspace.git(args, { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })).text);
  }
  return { oids, tips: shape.tips.map(index => oids[index]) };
}

async function nativeAncestry(workspace, graph, left, right) {
  const result = await workspace.git(['merge-base', '--is-ancestor', left, right], { allowFailure: true });
  assert.ok([0, 1].includes(result.code), result.stderr.toString());
  assert.equal(await graph.isAncestor(left, right), result.code === 0);
}

test('merge-base --all matches native Git on forty deterministic graph shapes', { timeout: 240_000 }, async context => {
  const availability = await gitAvailability();
  if (!availability.available) { context.skip(availability.reason); return; }
  context.diagnostic(`Reference: ${availability.version}; eight graph families at five depths; fixed DAG seeds 0x0a250001..5`);
  const workspace = await fixtureWorkspace('sharpforge-a25-graphs-');
  let repository;
  try {
    await workspace.git(['init', '-q', '--initial-branch=main']);
    const emptyTree = (await workspace.git(['mktree'], { input: '' })).text;
    repository = new GitRepository(await openNodeRepository({ directory: workspace.root }));
    await repository.init();
    const cases = [1, 2, 3, 4, 5].flatMap(graphFamilies);
    assert.equal(cases.length, 40);
    for (const [sequence, shape] of cases.entries()) {
      const { oids, tips } = await materializeGraph(workspace, shape, emptyTree, sequence);
      const reference = await workspace.git(['merge-base', '--all', ...tips], { allowFailure: true });
      assert.ok([0, 1].includes(reference.code), reference.stderr.toString());
      const expected = reference.text ? reference.text.split('\n').sort() : [];
      assert.deepEqual(await repository.graph.mergeBases(...tips), expected, shape.name);
      assert.deepEqual(await repository.graph.mergeBases(tips[1], tips[0]), expected, `${shape.name}, reversed tips`);
      await nativeAncestry(workspace, repository.graph, tips[0], tips[1]);
      await nativeAncestry(workspace, repository.graph, tips[1], tips[0]);
      assert.equal(await repository.graph.isAncestor(tips[0], tips[0]), true);
      if (shape.name.startsWith('criss-cross')) assert.equal(expected.length, 2);
      if (shape.name.startsWith('disconnected')) assert.deepEqual(expected, []);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(repository.graph.mergeBases(...tips, { signal: controller.signal }), { code: 'Cancelled' });
      const bounded = new CommitGraph({ odb: repository.odb, maxCommits: 1 });
      await assert.rejects(bounded.reachable(oids[shape.nodes.findIndex(parents => parents.length)]), { code: 'Limit' });
    }
    context.diagnostic('Defined comparison count: 40 graph shapes, 80 merge-base directions, 80 ancestry directions');
  } finally { repository?.dispose(); await workspace.dispose(); }
});

const paths = ['tracked.txt', 'deleted.txt', 'added.txt', 'binary.dat', 'untracked/nested.txt', 'ignored/cache.tmp'];

async function nativeStashFixture(workspace, name, algorithm) {
  const directory = join(workspace.root, `${name}-${algorithm}`);
  await mkdir(directory);
  const git = (args, options) => workspace.git(args, { ...options, cwd: directory });
  const write = (path, value) => workspace.write(directory, path, value);
  await git(['init', '-q', '--initial-branch=main', `--object-format=${algorithm}`]);
  await write('.gitignore', 'ignored/\n');
  await write('tracked.txt', 'base\n');
  await write('deleted.txt', 'delete this tracked file\n');
  await write('binary.dat', Uint8Array.of(0, 1, 2, 0, 255));
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'stash base']);
  await write('tracked.txt', 'staged\n');
  await write('added.txt', 'index addition\n');
  await write('binary.dat', Uint8Array.of(0, 3, 5, 0, 255));
  await rm(join(directory, 'deleted.txt'));
  await git(['add', '-A']);
  await write('tracked.txt', 'working copy\n');
  await write('added.txt', 'index addition with working edit\n');
  await write('binary.dat', Uint8Array.of(0, 4, 6, 0, 255));
  await write('untracked/nested.txt', 'untracked Unicode: 雪\n');
  await write('ignored/cache.tmp', 'ignored data stays outside an include-untracked stash\n');
  return { directory, git, write };
}

async function captureStashState(fixture) {
  const files = [];
  for (const path of paths) {
    const data = await readFile(join(fixture.directory, path)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    files.push([path, data ? Buffer.from(data).toString('base64') : null]);
  }
  return {
    files,
    index: (await fixture.git(['ls-files', '--stage', '-z'])).stdout.toString('utf8'),
    status: (await fixture.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout.toString('utf8')
  };
}

async function openFixtureRepository(fixture) {
  const repository = new GitRepository(await openNodeRepository({ directory: fixture.directory }));
  await repository.init();
  return repository;
}

async function sharpForgeStashToNative(workspace, algorithm) {
  const fixture = await nativeStashFixture(workspace, 'sharpforge-to-native', algorithm);
  const before = await captureStashState(fixture);
  const repo = await openFixtureRepository(fixture);
  try {
    const saved = await repo.stash('push', { includeUntracked: true, author: identity, committer: identity, message: 'portable snapshot' });
    assert.equal(saved.status, 'saved');
    assert.equal(saved.parents.length, 3);
    assert.equal((await fixture.git(['status', '--porcelain=v1', '--untracked-files=all'])).text, '');
    assert.equal((await fixture.git(['rev-parse', 'stash@{0}'])).text, saved.oid);
    assert.equal((await fixture.git(['rev-list', '--parents', '-n', '1', saved.oid])).text.split(' ').length, 4);
    await fixture.git(['stash', 'apply', '--index', saved.oid]);
    assert.deepEqual(await captureStashState(fixture), before);
    assert.equal((await fixture.git(['show', ':tracked.txt'])).text, 'staged');
  } finally { repo.dispose(); }
}

async function nativeStashToSharpForge(workspace, algorithm) {
  const fixture = await nativeStashFixture(workspace, 'native-to-sharpforge', algorithm);
  const before = await captureStashState(fixture);
  await fixture.git(['stash', 'push', '--include-untracked', '-m', 'native portable snapshot']);
  const oid = (await fixture.git(['rev-parse', 'refs/stash'])).text;
  const repo = await openFixtureRepository(fixture);
  try {
    assert.equal((await repo.stash('list'))[0].oid, oid);
    const controller = new AbortController();
    controller.abort();
    const clean = await captureStashState(fixture);
    await assert.rejects(repo.stash('apply', { restoreIndex: true, signal: controller.signal }), { code: 'Cancelled' });
    assert.deepEqual(await captureStashState(fixture), clean);
    await fixture.write('untracked/nested.txt', 'existing untracked file must survive\n');
    const blocked = await captureStashState(fixture);
    await assert.rejects(repo.stash('pop', { restoreIndex: true }), { code: 'Conflict' });
    assert.deepEqual(await captureStashState(fixture), blocked);
    assert.equal((await repo.stash('list'))[0].oid, oid);
    await rm(join(fixture.directory, 'untracked/nested.txt'));
    const applied = await repo.stash('pop', { restoreIndex: true });
    assert.equal(applied.status, 'applied');
    assert.equal(applied.dropped, true);
    assert.deepEqual(await captureStashState(fixture), before);
    assert.equal((await fixture.git(['stash', 'list'])).text, '');
  } finally { repo.dispose(); }
}

test('stash exchanges staged, working and untracked snapshots with native Git in both directions', { timeout: 180_000 }, async context => {
  const availability = await gitAvailability();
  if (!availability.available) { context.skip(availability.reason); return; }
  context.diagnostic(`Reference: ${availability.version}; SHA-1 and SHA-256; staged additions/deletions, binary edits and untracked paths`);
  const workspace = await fixtureWorkspace('sharpforge-a25-stash-');
  try {
    for (const algorithm of ['sha1', 'sha256']) {
      await context.test(`${algorithm}: SharpForge stash applies through git stash --index`, () => sharpForgeStashToNative(workspace, algorithm));
      await context.test(`${algorithm}: native stash restores through SharpForge with conflict and cancellation guards`,
        () => nativeStashToSharpForge(workspace, algorithm));
    }
  } finally { await workspace.dispose(); }
});

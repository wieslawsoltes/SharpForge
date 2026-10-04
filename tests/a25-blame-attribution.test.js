import test from 'node:test';
import assert from 'node:assert/strict';
import { GitRepository } from '../packages/git/src/repository.js';
import { encodeTree, encodeCommit } from '../packages/git/src/objects.js';
import { blame, blameIncremental } from '../packages/git/src/blame.js';
import { formatBlameIncremental } from '../packages/git/src/blame-incremental.js';
import { parseIgnoreRevs } from '../packages/git/src/blame-options.js';

const encode = text => new TextEncoder().encode(text);
const blockA = 'const alphaValue = calculateAlphaResult();\nreturn transformAlphaResult(alphaValue);\n';
const blockB = 'const betaValue = calculateBetaResult();\nreturn transformBetaResult(betaValue);\n';

async function snapshot(repository, files, { parents = [], name = 'initial', timestamp = 1700000000 } = {}) {
  const entries = [];
  for (const [path, text] of Object.entries(files)) {
    entries.push({ name: path, mode: 0o100644, oid: await repository.odb.write('blob', typeof text === 'string' ? encode(text) : text) });
  }
  const tree = await repository.odb.write('tree', encodeTree(entries, { algorithm: repository.algorithm }));
  const identity = { name, email: `${name}@example.test`, timestamp, timezone: '+0000' };
  const oid = await repository.odb.write('commit', encodeCommit({ tree, parents, author: identity, committer: identity, message: name },
    { algorithm: repository.algorithm }));
  await repository.refs.update('refs/heads/main', oid);
  return oid;
}

async function repository(algorithm = 'sha1') {
  const repo = new GitRepository({ algorithm });
  await repo.init();
  return repo;
}

test('incremental blame yields recent finalized chunks and only caches completed traversals', async () => {
  const repo = await repository();
  const initial = await snapshot(repo, { 'file.txt': 'one\ntwo\nthree\nfour\n' });
  const latest = await snapshot(repo, { 'file.txt': 'one\nchanged\nthree\nfour\nadded\n' },
    { parents: [initial], name: 'latest', timestamp: 1700000001 });
  const observed = [];
  const stream = blameIncremental(repo, 'file.txt', { onChunk: async chunk => { await Promise.resolve(); observed.push(chunk); } });
  const first = await stream.next();
  assert.equal(first.value.oid, latest);
  assert.equal(first.value.finalLine, 2);
  assert.equal(first.value.lineCount, 1);
  assert.equal(observed.length, 1);
  assert.equal(repo.history.blames.size, 0);
  await stream.return();
  assert.equal(repo.history.blames.size, 0);
  const result = await blame(repo, 'file.txt');
  assert.deepEqual(result.map(line => line.oid), [initial, latest, initial, initial, latest]);
  assert.deepEqual(result.map(line => line.finalLine), [1, 2, 3, 4, 5]);
  assert.ok(result.every(Object.isFrozen));
  assert.equal(repo.history.blames.size, 1);
  assert.deepEqual(await blame(repo, 'file.txt', { startLine: 2, endLine: 3 }), result.slice(1, 3));
  const wire = [];
  for await (const text of formatBlameIncremental(blameIncremental(repo, 'file.txt'))) wire.push(text);
  assert.ok(wire.every(text => text.endsWith('filename file.txt\n')));
  assert.ok(wire.every(text => !text.includes('\tchanged')));
  assert.equal(wire.join('').match(/^author /gm).length, 2);
});

test('blame cancellation, line bounds, work bounds, binary diagnostics and empty files are explicit', async () => {
  const repo = await repository();
  const initial = await snapshot(repo, { 'file.txt': 'first\nsecond\n', 'empty.txt': '', 'binary.bin': new Uint8Array([0, 1, 2]) });
  await snapshot(repo, { 'file.txt': 'modified\nsecond\n', 'empty.txt': '', 'binary.bin': new Uint8Array([0, 1, 2]) },
    { parents: [initial], name: 'edit', timestamp: 1700000001 });
  await assert.rejects(blame(repo, 'file.txt', { maxLines: 1 }), { code: 'Limit' });
  await assert.rejects(blame(repo, 'file.txt', { maxWork: 0 }), { code: 'Limit' });
  await assert.rejects(blame(repo, 'file.txt', { maxCommits: 0 }), { code: 'Limit' });
  await assert.rejects(blame(repo, 'file.txt', { startLine: 0 }), { code: 'Corrupt' });
  await assert.rejects(blame(repo, 'missing.txt'), { code: 'NotFound' });
  await assert.rejects(blame(repo, 'binary.bin'), { code: 'Unsupported' });
  assert.deepEqual(await blame(repo, 'empty.txt'), []);
  const controller = new AbortController();
  const stream = blameIncremental(repo, 'file.txt', { signal: controller.signal });
  await stream.next();
  controller.abort();
  await assert.rejects(stream.next(), { code: 'Cancelled' });
  assert.equal(repo.history.blames.size, 1, 'only the completed empty-file attribution is cached');
  await assert.rejects(blame(repo, 'file.txt', { signal: controller.signal }), { code: 'Cancelled' });
});

test('move detection attributes both sides of rearrangements and copied blocks within a file', async () => {
  const repo = await repository();
  const initial = await snapshot(repo, { 'file.txt': blockA + blockB });
  const moved = await snapshot(repo, { 'file.txt': blockB + blockA }, { parents: [initial], name: 'move', timestamp: 1700000001 });
  const plain = await blame(repo, 'file.txt');
  assert.ok(plain.some(line => line.oid === moved));
  const detected = await blame(repo, 'file.txt', { detectMoves: true });
  assert.ok(detected.every(line => line.oid === initial));
  assert.deepEqual(detected.map(line => line.originalLine), [3, 4, 1, 2]);
  assert.deepEqual(await blame(repo, 'file.txt', { detectMoves: true, moveThreshold: 10000 }), plain);
  const copied = await snapshot(repo, { 'file.txt': blockA + blockB + blockA },
    { parents: [initial], name: 'copy', timestamp: 1700000002 });
  const duplicate = await blame(repo, 'file.txt', { revision: copied, detectMoves: true });
  assert.ok(duplicate.every(line => line.oid === initial));
  assert.deepEqual(duplicate.map(line => line.originalLine), [1, 2, 3, 4, 1, 2]);
});

test('copy search distinguishes modified sources, file creation, and unchanged sources in later commits', async () => {
  const repo = await repository();
  const initial = await snapshot(repo, { 'source.txt': blockA, 'target.txt': blockB });
  const modified = await snapshot(repo, { 'source.txt': `${blockA}sourceChanged();\n`, 'target.txt': blockB + blockA },
    { parents: [initial], name: 'modified', timestamp: 1700000001 });
  const copied = await blame(repo, 'target.txt', { revision: modified, detectCopies: true });
  assert.ok(copied.slice(2).every(line => line.oid === initial && line.path === 'source.txt'));
  await assert.rejects(blame(repo, 'target.txt', { revision: modified, detectCopies: true, maxCopyCandidates: 0,
    copyThreshold: 41 }), { code: 'Limit' });
  const sourceOnly = await snapshot(repo, { 'source.txt': blockA }, { name: 'source', timestamp: 1700000002 });
  const created = await snapshot(repo, { 'source.txt': blockA, 'new.txt': blockB + blockA },
    { parents: [sourceOnly], name: 'created', timestamp: 1700000003 });
  assert.ok((await blame(repo, 'new.txt', { revision: created, detectCopies: true })).every(line => line.oid === created));
  const harder = await blame(repo, 'new.txt', { revision: created, copyLevel: 2 });
  assert.ok(harder.slice(2).every(line => line.oid === sourceOnly && line.path === 'source.txt'));
  const later = await snapshot(repo, { 'source.txt': blockA, 'target.txt': blockB + blockA },
    { parents: [initial], name: 'later', timestamp: 1700000003 });
  assert.ok((await blame(repo, 'target.txt', { revision: later, copyLevel: 2 })).slice(2).every(line => line.oid === later));
  assert.ok((await blame(repo, 'target.txt', { revision: later, copyLevel: 3 })).slice(2).every(line => line.path === 'source.txt'));
});

test('ignore-revs files resolve configuration, comments, resets, and explicit revisions into cache identity', async () => {
  const repo = await repository();
  const initial = await snapshot(repo, { 'file.txt': 'const first = calculateFirst();\nconst second = calculateSecond();\n' });
  const format = await snapshot(repo, { 'file.txt': '  const first=calculateFirst();\n  const second=calculateSecond();\n' },
    { parents: [initial], name: 'format', timestamp: 1700000001 });
  await repo.worktree.write('.git-blame-ignore-revs', encode(`# formatting only\n\n${format} # explained\n`));
  repo.config.set('blame.ignoreRevsFile', '.git-blame-ignore-revs');
  const ignored = await blame(repo, 'file.txt');
  assert.ok(ignored.every(line => line.oid === initial && line.ignored));
  assert.deepEqual(ignored.map(line => line.originalLine), [1, 2]);
  const reset = await blame(repo, 'file.txt', { ignoreRevsFile: '' });
  assert.ok(reset.every(line => line.oid === format && !line.ignored));
  assert.ok((await blame(repo, 'file.txt', { ignoreRevsFile: '', ignoreRevs: [format] })).every(line => line.ignored));
  const whitespace = await blame(repo, 'file.txt', { ignoreRevsFile: '', ignoreWhitespace: true });
  assert.ok(whitespace.every(line => line.oid === initial && !line.ignored));
  assert.deepEqual([...parseIgnoreRevs(`${format}\n# trailing comment\n${format}\n`)], [format]);
  assert.throws(() => parseIgnoreRevs('main\n'), { code: 'Corrupt' });
  assert.throws(() => parseIgnoreRevs(format, { maxRevisions: 0 }), { code: 'Limit' });
  await assert.rejects(blame(repo, 'file.txt', { ignoreRevsFile: 'missing' }), { code: 'NotFound' });
  await assert.rejects(blame(repo, 'file.txt', { ignoreRevsFile: '../outside' }), { code: 'Unsafe' });
  await assert.rejects(blame(repo, 'file.txt', { maxIgnoreFileBytes: 1 }), { code: 'Limit' });
});

test('ignored additions without a matching parent retain unblamable attribution', async () => {
  const repo = await repository();
  const initial = await snapshot(repo, { 'file.txt': 'alpha\n' });
  const ignored = await snapshot(repo, { 'file.txt': 'alpha\nXYZ\n\n' },
    { parents: [initial], name: 'ignored', timestamp: 1700000001 });
  const result = await blame(repo, 'file.txt', { ignoreRevs: [ignored] });
  assert.equal(result[0].oid, initial);
  assert.ok(result.slice(1).every(line => line.oid === ignored && line.unblamable && !line.ignored));
});

test('merge parents, whole-file renames, shallow boundaries, and SHA-256 retain source identity', async () => {
  for (const algorithm of ['sha1', 'sha256']) {
    const repo = await repository(algorithm);
    const initial = await snapshot(repo, { 'old.txt': 'left\nright\n' });
    const left = await snapshot(repo, { 'old.txt': 'changed left\nright\n' },
      { parents: [initial], name: 'left', timestamp: 1700000001 });
    const right = await snapshot(repo, { 'old.txt': 'left\nchanged right\n' },
      { parents: [initial], name: 'right', timestamp: 1700000002 });
    const merge = await snapshot(repo, { 'old.txt': 'changed left\nchanged right\n' },
      { parents: [left, right], name: 'merge', timestamp: 1700000003 });
    assert.deepEqual((await blame(repo, 'old.txt')).map(line => line.oid), [left, right]);
    assert.deepEqual((await blame(repo, 'old.txt', { firstParent: true })).map(line => line.oid), [left, merge]);
    const renamed = await snapshot(repo, { 'new.txt': 'changed left\nchanged right\n' },
      { parents: [merge], name: 'renamed', timestamp: 1700000004 });
    assert.ok((await blame(repo, 'new.txt')).every(line => line.path === 'old.txt'));
    await repo.store.set('shallow', encode(`${renamed}\n`));
    const shallow = await blame(repo, 'new.txt');
    assert.ok(shallow.every(line => line.oid === renamed && line.boundary));
  }
});

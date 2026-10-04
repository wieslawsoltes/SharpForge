import test from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeWorktree } from '../packages/git/src/fs/node-worktree.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-status-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested', 'file.txt'), 'authorized\n');
  return { root, worktree: new NodeWorktree(root) };
}

async function collect(worktree, paths, options) {
  const result = [];
  for await (const entry of worktree.readMany(paths, options)) result.push(entry);
  return result;
}

test('owned snapshots preserve bytes and remain isolated from edited snapshot maps', async t => {
  const { root, worktree } = await fixture(t);
  for (let index = 0; index < 20; index++) await writeFile(join(root, `file-${index}.txt`), `file ${index}\n`);
  const snapshot = await worktree.scan();
  const paths = [...snapshot.keys()];
  const records = await collect(worktree, paths, { snapshot });
  assert.equal(records.length, 21);
  for (const [path, file] of records) assert.deepEqual(file.data, (await worktree.read(path)).data);
  assert.ok(Object.isFrozen(snapshot.get('nested/file.txt')));
  snapshot.set('nested/file.txt', { mode: 0o100644, stat: {} });
  const fallback = await collect(worktree, ['nested/file.txt'], { snapshot });
  assert.equal(new TextDecoder().decode(fallback[0][1].data), 'authorized\n');
  worktree.clearScanCache();
  assert.equal((await collect(worktree, ['nested/file.txt'], { snapshot })).length, 1);
});

test('snapshot reads reject a replacement inode before exposing its bytes', {
  skip: !constants.O_NOFOLLOW && 'Platform uses the checked-path reader instead of snapshot acceleration'
}, async t => {
  const { root, worktree } = await fixture(t);
  const snapshot = await worktree.scan();
  await rename(join(root, 'nested', 'file.txt'), join(root, 'nested', 'original.txt'));
  await writeFile(join(root, 'nested', 'file.txt'), 'replacement\n');
  await assert.rejects(collect(worktree, ['nested/file.txt'], { snapshot }), { code: 'Conflict' });
});

test('owned and forged snapshots refuse a parent changed into a symlink even to the original directory', {
  skip: process.platform === 'win32' && 'Creating directory symlinks requires a separately granted Windows privilege'
}, async t => {
  const { root, worktree } = await fixture(t);
  const snapshot = await worktree.scan();
  await rename(join(root, 'nested'), join(root, 'saved'));
  await symlink('saved', join(root, 'nested'), 'dir');
  await assert.rejects(collect(worktree, ['nested/file.txt'], { snapshot }), { code: 'Unsafe' });
  await assert.rejects(collect(worktree, ['nested/file.txt'], { snapshot: new Map(snapshot) }), { code: 'Unsafe' });
});

test('snapshot reads retain cancellation, size limits and asynchronous large-file handling', async t => {
  const { root, worktree } = await fixture(t);
  const bytes = new Uint8Array(65537).fill(83);
  await writeFile(join(root, 'large.bin'), bytes);
  const snapshot = await worktree.scan();
  assert.deepEqual((await collect(worktree, ['large.bin'], { snapshot }))[0][1].data, bytes);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(collect(worktree, ['nested/file.txt'], { snapshot, signal: controller.signal }), { code: 'Cancelled' });
  await assert.rejects(collect(worktree, ['nested/file.txt', 'large.bin'], { snapshot, maxEntries: 1 }), { code: 'Limit' });
  const bounded = new NodeWorktree(root, { maxFileBytes: 65536 });
  await assert.rejects(bounded.scan(), { code: 'Limit' });
});

for (const snapshotKind of ['owned', 'copied', 'edited']) {
  test(`${snapshotKind} snapshot iteration stops when aborted between records`, async t => {
    const { root, worktree } = await fixture(t);
    await writeFile(join(root, 'next.txt'), 'next\n');
    const owned = await worktree.scan();
    const snapshot = snapshotKind === 'copied' ? new Map(owned) : owned;
    if (snapshotKind === 'edited') snapshot.set('next.txt', { mode: 0o100644, stat: {} });
    const controller = new AbortController();
    const iterator = worktree.readMany(['nested/file.txt', 'next.txt'], { snapshot, signal: controller.signal });
    const first = await iterator.next();
    assert.equal(first.done, false);
    assert.equal(first.value[0], 'nested/file.txt');
    controller.abort();
    await assert.rejects(iterator.next(), { code: 'Cancelled' });
  });
}

test('large-file iteration checks cancellation after an awaited read completes', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'large.bin'), new Uint8Array(65537).fill(83));
  const controller = new AbortController();
  class AbortingWorktree extends NodeWorktree {
    async read(path, options) {
      const file = await super.read(path, options);
      controller.abort();
      return file;
    }
  }
  const worktree = new AbortingWorktree(root);
  const snapshot = await worktree.scan();
  const iterator = worktree.readMany(['large.bin'], { snapshot, signal: controller.signal });
  await assert.rejects(iterator.next(), { code: 'Cancelled' });
});

test('owned and copied snapshots reject a worktree root replaced with an outside symlink', {
  skip: process.platform === 'win32' && 'Creating directory symlinks requires a separately granted Windows privilege'
}, async t => {
  const container = await mkdtemp(join(tmpdir(), 'sharpforge-status-root-'));
  t.after(() => rm(container, { recursive: true, force: true }));
  const root = join(container, 'worktree');
  const outside = join(container, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, 'file.txt'), 'authorized\n');
  await writeFile(join(outside, 'file.txt'), 'outside secret\n');
  await writeFile(join(root, 'large.bin'), new Uint8Array(65537).fill(65));
  await writeFile(join(outside, 'large.bin'), new Uint8Array(65537).fill(83));
  const worktree = new NodeWorktree(root);
  const snapshot = await worktree.scan();
  await rename(root, join(container, 'saved'));
  await symlink(outside, root, 'dir');
  for (const candidate of [snapshot, new Map(snapshot)]) {
    await assert.rejects(collect(worktree, ['file.txt'], { snapshot: candidate }), { code: 'Unsafe' });
    await assert.rejects(collect(worktree, ['large.bin'], { snapshot: candidate }), { code: 'Unsafe' });
  }
  await assert.rejects(worktree.read('file.txt'), { code: 'Unsafe' });
  await assert.rejects(worktree.read('large.bin'), { code: 'Unsafe' });
});

test('empty directory chains cannot retain more parent proofs than the scan limit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-status-proof-bound-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worktree = new NodeWorktree(root);
  assert.equal((await worktree.scan({ maxEntries: 0 })).size, 0);
  await mkdir(join(root, 'a', 'b', 'c'), { recursive: true });
  await assert.rejects(worktree.scan({ maxEntries: 1 }), { code: 'Limit' });
  assert.equal((await worktree.scan({ maxEntries: 3 })).size, 0);
});

test('status batches retain the one-MiB small-file bound, byte order and cancellation', async t => {
  const { root, worktree } = await fixture(t);
  const paths = [];
  for (let index = 0; index < 17; index++) {
    const path = `batch-${index}.bin`;
    paths.push(path);
    await writeFile(join(root, path), new Uint8Array(65536).fill(index));
  }
  const snapshot = await worktree.scan();
  const flattened = [];
  for await (const batch of worktree.readBatches(paths, { snapshot })) {
    assert.ok(batch.length <= 16);
    assert.ok(batch.reduce((sum, [, file]) => sum + file.data.length, 0) <= 1024 * 1024);
    flattened.push(...batch);
  }
  assert.deepEqual(flattened.map(([path]) => path), paths);
  for (let index = 0; index < flattened.length; index++) {
    assert.deepEqual(flattened[index][1].data, new Uint8Array(65536).fill(index));
  }
  const controller = new AbortController();
  const iterator = worktree.readBatches(paths, { snapshot, signal: controller.signal });
  assert.equal((await iterator.next()).done, false);
  controller.abort();
  await assert.rejects(iterator.next(), { code: 'Cancelled' });
  await writeFile(join(root, 'large.bin'), new Uint8Array(65537).fill(91));
  const largeSnapshot = await worktree.scan();
  for await (const batch of worktree.readBatches(['large.bin', paths[0]], { snapshot: largeSnapshot })) {
    assert.equal(batch.length, 1);
    assert.ok(batch[0][1].data.length <= 65537);
  }
});

test('status batching honors a Node adapter that overrides per-record reading', async t => {
  const { root } = await fixture(t);
  const observed = [];
  class CustomWorktree extends NodeWorktree {
    async *readMany(paths, options) {
      for await (const record of super.readMany(paths, options)) {
        observed.push(record[0]);
        yield record;
      }
    }
  }
  const worktree = new CustomWorktree(root);
  const snapshot = await worktree.scan();
  for await (const batch of worktree.readBatches(['nested/file.txt'], { snapshot })) {
    assert.equal(new TextDecoder().decode(batch[0][1].data), 'authorized\n');
  }
  assert.deepEqual(observed, ['nested/file.txt']);
});

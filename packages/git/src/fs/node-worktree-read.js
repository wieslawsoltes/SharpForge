import { closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { validateCheckoutPath } from '../path-safety.js';
import { nodeWorktreeMode, nodeWorktreeStat, requireStableRead } from './node-worktree-stat.js';
import { readNodeDescriptor, readSnapshotBatch } from './node-worktree-read-batch.js';

const smallFileBytes = 64 * 1024;
const encoder = new TextEncoder();
const pathOptions = Object.freeze({ throwIfNoEntry: false });
const statOptions = Object.freeze({ bigint: true, throwIfNoEntry: false });
const descriptorOptions = Object.freeze({ bigint: true });

function checkedPath(directory, path) {
  const parts = validateCheckoutPath(path).split('/');
  const root = lstatSync(directory, pathOptions);
  if (!root) return null;
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new GitError('Unsafe', 'Worktree root is not a regular directory', { path });
  }
  let parent = directory;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    const stat = lstatSync(parent, pathOptions);
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new GitError('Unsafe', 'Worktree parent is not a regular directory', { path });
    }
  }
  return join(parent, parts.at(-1));
}

function readSmallFile(worktree, path) {
  const observedAt = BigInt(Date.now()) * 1000000n;
  const absolute = checkedPath(worktree.directory, path);
  if (!absolute) return null;
  const before = lstatSync(absolute, statOptions);
  if (!before || before.isDirectory()) return null;
  const mode = nodeWorktreeMode(before);
  checkLimit(Number(before.size), worktree.maxFileBytes, 'Worktree file');
  if (before.size > BigInt(smallFileBytes)) return undefined;
  let data;
  if (before.isSymbolicLink()) {
    data = encoder.encode(readlinkSync(absolute));
    requireStableRead(before, lstatSync(absolute, descriptorOptions), path);
  } else {
    const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      requireStableRead(before, fstatSync(descriptor, descriptorOptions), path);
      data = readNodeDescriptor(descriptor, before, path);
    } finally {
      closeSync(descriptor);
    }
  }
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), mode, stat: nodeWorktreeStat(before, observedAt) };
}

function* batches(paths, maximum) {
  let batch = [];
  let count = 0;
  for (const path of paths) {
    checkLimit(++count, maximum, 'Worktree file count');
    batch.push(path);
    if (batch.length === 16) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

/** Expose at most 16 small files or one fallback file per asynchronous continuation. */
export async function* readNodeWorktreeBatches(worktree, paths, options = {}, snapshots) {
  let deadline = performance.now() + 8;
  for (const batch of batches(paths, options.maxEntries ?? 1000000)) {
    checkCancelled(options.signal);
    const context = constants.O_NOFOLLOW && snapshots?.readContext(options.snapshot, batch);
    if (context) {
      yield readSnapshotBatch(worktree, context, options);
    } else {
      for (const path of batch) {
        checkCancelled(options.signal);
        let file;
        try { file = readSmallFile(worktree, path); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          file = null;
        }
        if (file === undefined) {
          checkCancelled(options.signal);
          file = await worktree.read(path, options);
        }
        checkCancelled(options.signal);
        yield [[path, file]];
      }
    }
    if (performance.now() >= deadline) {
      await setImmediate();
      checkCancelled(options.signal);
      deadline = performance.now() + 8;
    }
  }
}

/** Preserve per-record iteration and cancellation for ordinary worktree consumers. */
export async function* readNodeWorktreeFiles(worktree, paths, options = {}, snapshots) {
  for await (const records of readNodeWorktreeBatches(worktree, paths, options, snapshots)) {
    for (const record of records) {
      checkCancelled(options.signal);
      yield record;
    }
  }
}

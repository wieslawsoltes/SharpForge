import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { nodeWorktreeMode, nodeWorktreeStat, requireStableRead } from './node-worktree-stat.js';

const descriptorOptions = Object.freeze({ bigint: true });
const parentOptions = Object.freeze({ bigint: true, throwIfNoEntry: false });

export function readNodeDescriptor(descriptor, before, path) {
  const data = new Uint8Array(Number(before.size));
  let offset = 0;
  while (offset < data.length) {
    const length = readSync(descriptor, data, offset, data.length - offset, offset);
    if (!length) throw new GitError('Conflict', 'Worktree file changed while it was being read', { path });
    offset += length;
  }
  requireStableRead(before, fstatSync(descriptor, descriptorOptions), path);
  return data;
}

function verifyParents(parents) {
  for (const proof of parents) {
    const current = lstatSync(proof.absolute, parentOptions);
    if (!current || !current.isDirectory() || current.isSymbolicLink()
      || current.dev !== proof.stat.dev || current.ino !== proof.stat.ino) {
      throw new GitError('Unsafe', 'Worktree parent changed after the directory scan');
    }
  }
}

function readSnapshotFile(worktree, token) {
  const observedAt = BigInt(Date.now()) * 1000000n;
  let descriptor;
  try {
    descriptor = openSync(token.absolute, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0));
    const before = fstatSync(descriptor, descriptorOptions);
    requireStableRead(token.stat, before, token.path);
    checkLimit(Number(before.size), Math.min(worktree.maxFileBytes, 64 * 1024), 'Worktree batch file');
    const data = readNodeDescriptor(descriptor, before, token.path);
    return { data, mode: nodeWorktreeMode(before), stat: nodeWorktreeStat(before, observedAt) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') throw new GitError('Unsafe', 'Worktree file changed into a symbolic link', { path: token.path });
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Validate each opened inode before reading, and all parent proofs before exposing a bounded batch. */
export function readSnapshotBatch(worktree, context, options) {
  checkCancelled(options.signal);
  verifyParents(context.parents);
  const result = [];
  for (const token of context.tokens) {
    checkCancelled(options.signal);
    result.push([token.path, readSnapshotFile(worktree, token)]);
  }
  verifyParents(context.parents);
  checkCancelled(options.signal);
  return result;
}

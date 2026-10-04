import { GitError } from '../errors.js';

const second = 1000000000n;
const millisecond = 1000000n;

function timestampSettled(value, now) {
  // Whole-second timestamps may come from a coarse filesystem. Never cache a
  // read made inside that timestamp's ambiguity window, even on later scans.
  const precision = value % second === 0n ? second : millisecond;
  return value + precision < now;
}

export function nodeWorktreeIdentity(stat, now = BigInt(Date.now()) * millisecond) {
  return {
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeNs) / 1000000,
    identity: { dev: stat.dev, ino: stat.ino, size: stat.size, mode: stat.mode,
      mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs },
    cacheable: timestampSettled(stat.mtimeNs, now) && timestampSettled(stat.ctimeNs, now)
  };
}

export function nodeWorktreeStat(stat, now) {
  return {
    ...nodeWorktreeIdentity(stat, now),
    ctimeSeconds: Number(stat.ctimeNs / second),
    ctimeNanoseconds: Number(stat.ctimeNs % second),
    mtimeSeconds: Number(stat.mtimeNs / second),
    mtimeNanoseconds: Number(stat.mtimeNs % second),
    dev: Number(stat.dev & 0xffffffffn),
    ino: Number(stat.ino & 0xffffffffn),
    uid: Number(stat.uid & 0xffffffffn),
    gid: Number(stat.gid & 0xffffffffn)
  };
}

export function nodeWorktreeMode(stat) {
  if (stat.isSymbolicLink()) return 0o120000;
  if (!stat.isFile()) throw new GitError('Unsafe', 'Unsupported worktree filesystem object');
  return stat.mode & 0o111n ? 0o100755 : 0o100644;
}

export function requireStableRead(before, after, path) {
  if (!sameNodeStat(before, after)) {
    throw new GitError('Conflict', 'Worktree file changed while it was being read', { path });
  }
}

export function sameNodeStat(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mode === after.mode
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

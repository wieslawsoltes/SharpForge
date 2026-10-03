import { GitError, checkLimit } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function cursor(bytes, hashLength) {
  let position = 0;
  return {
    get remaining() { return bytes.length - position; },
    text(delimiter = 0) {
      const end = bytes.indexOf(delimiter, position);
      if (end < 0) throw new GitError('Corrupt', 'Unterminated Git index extension field');
      let value;
      try { value = decoder.decode(bytes.subarray(position, end)); }
      catch { throw new GitError('Unsupported', 'Index extension path is not UTF-8'); }
      position = end + 1;
      return value;
    },
    oid() {
      if (position + hashLength > bytes.length) throw new GitError('Corrupt', 'Truncated index extension object id');
      const value = Array.from(bytes.subarray(position, position + hashLength), byte => byte.toString(16).padStart(2, '0')).join('');
      position += hashLength;
      return value;
    }
  };
}

function oidBytes(oid, hashLength) {
  if (!new RegExp(`^[a-f0-9]{${hashLength * 2}}$`, 'u').test(oid)) throw new GitError('Corrupt', 'Invalid extension object id');
  return Uint8Array.from(oid.match(/../gu), value => Number.parseInt(value, 16));
}

function concat(parts) {
  const length = checkLimit(parts.reduce((sum, part) => sum + part.length, 0), 256 * 1024 * 1024, 'Index extension bytes');
  const result = new Uint8Array(length);
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}

/** Decode Git's recursive cache-tree extension, including invalidated (-1) cache nodes. */
export function decodeTreeCache(bytes, { algorithm = 'sha1', maxNodes = 1000000 } = {}) {
  checkLimit(bytes.length, 256 * 1024 * 1024, 'Cache-tree bytes');
  const stream = cursor(bytes, algorithm === 'sha256' ? 32 : 20);
  const stack = [];
  let root = null;
  let count = 0;
  while (stream.remaining) {
    checkLimit(++count, maxNodes, 'Cache-tree nodes');
    while (stack.length && stack.at(-1).remaining === 0) stack.pop();
    checkLimit(stack.length, 512, 'Cache-tree depth');
    const name = stream.text();
    const fields = /^(-?\d+) (\d+)$/u.exec(stream.text(10));
    if (!fields) throw new GitError('Corrupt', 'Invalid cache-tree node counts');
    const entryCount = Number(fields[1]);
    const subtreeCount = Number(fields[2]);
    if (entryCount < -1 || !Number.isSafeInteger(entryCount)) throw new GitError('Corrupt', 'Invalid cache-tree entry count');
    checkLimit(subtreeCount, maxNodes, 'Cache-tree children');
    const node = { name, entryCount, subtreeCount, oid: entryCount >= 0 ? stream.oid() : null, children: [] };
    if (stack.length) {
      const parent = stack.at(-1);
      parent.node.children.push(node);
      parent.remaining--;
    } else if (root) throw new GitError('Corrupt', 'Cache-tree has multiple roots');
    else root = node;
    stack.push({ node, remaining: subtreeCount });
  }
  if (stack.some(item => item.remaining !== 0)) throw new GitError('Corrupt', 'Cache-tree children are truncated');
  return root;
}

export function encodeTreeCache(root, { algorithm = 'sha1' } = {}) {
  const parts = [];
  const pending = root ? [root] : [];
  let count = 0;
  while (pending.length) {
    checkLimit(++count, 1000000, 'Cache-tree nodes');
    const node = pending.pop();
    if (node.name.includes('\0')) throw new GitError('Corrupt', 'Invalid cache-tree node name');
    parts.push(encoder.encode(`${node.name}\0${node.entryCount} ${node.children.length}\n`));
    if (node.entryCount >= 0) parts.push(oidBytes(node.oid, algorithm === 'sha256' ? 32 : 20));
    for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
  }
  return concat(parts);
}

/** Decode saved stage 1/2/3 resolutions from Git's REUC extension. */
export function decodeResolveUndo(bytes, { algorithm = 'sha1', maxEntries = 1000000 } = {}) {
  checkLimit(bytes.length, 256 * 1024 * 1024, 'Resolve-undo bytes');
  const stream = cursor(bytes, algorithm === 'sha256' ? 32 : 20);
  const result = [];
  while (stream.remaining) {
    checkLimit(result.length + 1, maxEntries, 'Resolve-undo paths');
    const path = stream.text();
    const modes = [stream.text(), stream.text(), stream.text()];
    if (!path || modes.some(mode => !/^[0-7]+$/u.test(mode))) throw new GitError('Corrupt', 'Invalid resolve-undo entry');
    const stages = [null];
    for (const text of modes) {
      const mode = Number.parseInt(text, 8);
      stages.push(mode ? { mode, oid: stream.oid() } : null);
    }
    result.push({ path, stages });
  }
  return result;
}

export function encodeResolveUndo(entries, { algorithm = 'sha1' } = {}) {
  const parts = [];
  for (const entry of entries) {
    if (!entry.path || entry.path.includes('\0')) throw new GitError('Corrupt', 'Invalid resolve-undo path');
    const stages = [entry.stages[1], entry.stages[2], entry.stages[3]];
    parts.push(encoder.encode(`${entry.path}\0${stages.map(stage => (stage?.mode ?? 0).toString(8)).join('\0')}\0`));
    for (const stage of stages) if (stage?.mode) parts.push(oidBytes(stage.oid, algorithm === 'sha256' ? 32 : 20));
  }
  return concat(parts);
}

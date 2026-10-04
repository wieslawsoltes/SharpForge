import { GitError, checkCancelled, checkLimit } from './errors.js';
import { hashObject } from './hash.js';
import { validateCheckoutPath } from './path-safety.js';
import { encodeText, decodeText } from './protocol/bytes.js';

function directoryPath(value) {
  if (value === '' || value === '.') return '';
  return validateCheckoutPath(value.replace(/\/$/, ''));
}

const escapePattern = value => value.replace(/[\\*?\[\]]/g, '\\$&');

/** Cone mode includes selected directory subtrees, root files and files directly inside ancestor directories. */
export class SparseCheckout {
  constructor(directories = [], { maxDirectories = 10_000 } = {}) {
    checkLimit(directories.length, maxDirectories, 'Sparse directories');
    const unique = [...new Set(directories.map(directoryPath))].sort();
    this.directories = [];
    for (const path of unique) {
      const previous = this.directories.at(-1);
      if (previous === '' || (previous !== undefined && path.startsWith(`${previous}/`))) continue;
      this.directories.push(path);
    }
    this.ancestors = new Set(['']);
    this.recursive = new Set(this.directories);
    for (const path of this.directories) {
      const parts = path.split('/');
      parts.pop();
      while (parts.length) { this.ancestors.add(parts.join('/')); parts.pop(); }
    }
  }

  includes(path) {
    validateCheckoutPath(path);
    if (this.recursive.has('')) return true;
    const slash = path.lastIndexOf('/');
    const parent = slash < 0 ? '' : path.slice(0, slash);
    if (this.ancestors.has(parent)) return true;
    let directory = parent;
    while (directory) {
      if (this.recursive.has(directory)) return true;
      const separator = directory.lastIndexOf('/');
      directory = separator < 0 ? '' : directory.slice(0, separator);
    }
    return false;
  }

  toPatterns() {
    if (this.recursive.has('')) return '/*\n';
    const lines = ['/*', '!/*/'];
    const parents = [...this.ancestors].filter(Boolean).sort();
    const additions = new Set([...parents, ...this.directories]);
    for (const directory of [...additions].sort()) {
      const escaped = escapePattern(directory);
      lines.push(`/${escaped}/`);
      if (!this.recursive.has(directory)) lines.push(`!/${escaped}/*/`);
    }
    return `${lines.join('\n')}\n`;
  }

  static fromPatterns(source) {
    const text = typeof source === 'string' ? source : decodeText(source);
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 1 && lines[0] === '/*') return new SparseCheckout(['']);
    if (lines[0] !== '/*' || lines[1] !== '!/*/') throw new GitError('Unsupported', 'Only canonical cone-mode sparse patterns are supported');
    const parents = new Set(lines.filter(line => line.startsWith('!/') && line.endsWith('/*/')).map(line => line.slice(2, -3)));
    const directories = lines.slice(2).filter(line => !line.startsWith('!') && line.startsWith('/') && line.endsWith('/'))
      .map(line => line.slice(1, -1)).filter(path => !parents.has(path)).map(path => path.replace(/\\([\\*?\[\]])/g, '$1'));
    const cone = new SparseCheckout(directories);
    if (cone.toPatterns() !== `${lines.join('\n')}\n`) throw new GitError('Unsupported', 'Sparse patterns are not a canonical cone');
    return cone;
  }
}

/** Plan all skips/materialization before effects and refuse to discard dirty tracked files. */
export async function applySparseCheckout({ index, worktree, odb, directories, cone = new SparseCheckout(directories),
  algorithm = 'sha1', signal, force = false, clean, smudge, store, saveIndex }) {
  const updated = index.clone();
  const writes = [];
  const removals = [];
  for (const entry of index.entries) {
    checkCancelled(signal);
    if (entry.stage) continue;
    const included = cone.includes(entry.path);
    const current = await worktree.read(entry.path, { signal });
    if (!included && current) {
      const content = clean ? await clean(entry.path, current.data) : current.data;
      if (!force && await hashObject('blob', content, { algorithm }) !== entry.oid) {
        throw new GitError('Conflict', 'Sparse checkout would remove a modified file', { path: entry.path });
      }
      removals.push(entry.path);
    }
    if (included && !current && entry.mode !== 0o160000) writes.push(entry);
    updated.set({ ...entry, skipWorktree: !included });
  }
  if (typeof odb.prefetch === 'function') await odb.prefetch(writes.map(entry => entry.oid), { signal });
  for (const entry of writes) {
    const object = await odb.read(entry.oid, { signal });
    if (object.type !== 'blob') throw new GitError('Corrupt', 'Sparse file entry points to a non-blob object');
    const data = smudge ? await smudge(entry.path, object.data) : object.data;
    await worktree.write(entry.path, data, { mode: entry.mode, signal });
  }
  for (const path of removals) await worktree.remove(path, { signal });
  if (store) await store.set('info/sparse-checkout', encodeText(cone.toPatterns()), { signal });
  await saveIndex?.(updated, { signal });
  return { index: updated, cone, written: writes.map(entry => entry.path), removed: removals };
}

import { GitError, checkLimit } from './errors.js';
import { hashBytes } from './hash.js';
import { decodeIndexEntries, encodeIndexEntries } from './index-file-entries.js';
import { decodeTreeCache, decodeResolveUndo, encodeResolveUndo } from './index-file-extensions.js';
import { TreeView } from './tree-view.js';
import { IndexEntryMap } from './index-entry-map.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function digestBytes(digest) {
  return Uint8Array.from(digest.match(/../gu), part => Number.parseInt(part, 16));
}

function key(path, stage) {
  return `${stage}:${path}`;
}

function treeEntry(entry) { return entry.stage === 0 && !entry.intentToAdd; }

/** Git index entries indexed by path and conflict stage, with lossless extension payloads. */
export class GitIndex {
  #stageZero = new Map();
  #treeView = new TreeView(this.#stageZero, treeEntry);

  constructor({ version = 2, entries = [], extensions = [] } = {}) {
    if (![2, 3, 4].includes(version)) throw new GitError('Unsupported', 'Unsupported Git index version', { version });
    this.version = version;
    this.extensions = extensions.map(extension => ({ ...extension, data: extension.data.slice() }));
    this.byPath = new IndexEntryMap(this.#stageZero, () => { this.sorted = null; this.dirty = true; });
    this.sorted = null;
    this.dirty = false;
    for (const entry of entries) this.set(entry);
    this.dirty = false;
  }

  get entries() {
    if (!this.sorted) {
      this.sorted = [...this.byPath.values()].sort((left, right) => {
        const before = left.nameBytes;
        const after = right.nameBytes;
        for (let index = 0; index < Math.min(before.length, after.length); index++) {
          if (before[index] !== after[index]) return before[index] - after[index];
        }
        return before.length - after.length || left.stage - right.stage;
      });
    }
    return this.sorted;
  }

  get(path, stage = 0) {
    return (stage === 0 ? this.#stageZero.get(path) : this.byPath.get(key(path, stage))) ?? null;
  }

  get treeView() { return this.#treeView; }

  set(entry) {
    const stage = entry.stage ?? 0;
    if (typeof entry.path !== 'string' || !entry.path || entry.path.includes('\0') || stage < 0 || stage > 3) {
      throw new GitError('Corrupt', 'Invalid index entry', { path: entry.path, stage });
    }
    const value = { ...entry, nameBytes: encoder.encode(entry.path), stage, stat: { ...entry.stat } };
    this.byPath.set(key(entry.path, stage), value);
    this.sorted = null;
    this.dirty = true;
    return this;
  }

  remove(path, stage) {
    if (stage === undefined) for (let value = 0; value < 4; value++) this.byPath.delete(key(path, value));
    else this.byPath.delete(key(path, stage));
    this.sorted = null;
    this.dirty = true;
  }

  clone() {
    const result = new GitIndex({ version: this.version, entries: this.entries, extensions: this.extensions });
    result.dirty = this.dirty;
    return result;
  }

  get unmerged() {
    return this.entries.filter(entry => entry.stage !== 0);
  }

  cacheTree(options) {
    const extension = this.extensions.find(item => item.signature === 'TREE');
    return extension ? decodeTreeCache(extension.data, options) : null;
  }

  resolveUndo(options) {
    const extension = this.extensions.find(item => item.signature === 'REUC');
    return extension ? decodeResolveUndo(extension.data, options) : [];
  }

  recordResolution(path, stages, options) {
    const entries = this.resolveUndo(options).filter(entry => entry.path !== path);
    entries.push({ path, stages });
    this.extensions = this.extensions.filter(extension => extension.signature !== 'REUC');
    this.extensions.push({ signature: 'REUC', data: encodeResolveUndo(entries, options) });
    this.dirty = true;
  }
}

/** Decode and authenticate a DIRC v2/v3/v4 file; allocations are bounded before parsing. */
export async function decodeIndex(bytes, { algorithm = 'sha1', maxEntries = 1000000, maxBytes = 256 * 1024 * 1024 } = {}) {
  checkLimit(bytes?.length, maxBytes, 'Git index bytes');
  const hashLength = algorithm === 'sha256' ? 32 : 20;
  if (bytes.length < 12 + hashLength || decoder.decode(bytes.subarray(0, 4)) !== 'DIRC') {
    throw new GitError('Corrupt', 'Invalid Git index header');
  }
  const end = bytes.length - hashLength;
  if (hex(bytes.subarray(end)) !== await hashBytes(bytes.subarray(0, end), { algorithm })) {
    throw new GitError('Corrupt', 'Git index checksum mismatch');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4);
  const count = checkLimit(view.getUint32(8), maxEntries, 'Git index entries');
  if (![2, 3, 4].includes(version)) throw new GitError('Unsupported', 'Unsupported Git index version', { version });
  const parsed = decodeIndexEntries(bytes, { count, version, hashLength, end });
  const extensions = [];
  let position = parsed.position;
  while (position < end) {
    if (position + 8 > end) throw new GitError('Corrupt', 'Truncated Git index extension');
    const signature = decoder.decode(bytes.subarray(position, position + 4));
    const size = view.getUint32(position + 4);
    if (size > end - position - 8) throw new GitError('Corrupt', 'Truncated Git index extension payload', { signature });
    if (/^[a-z]/u.test(signature) && !['link', 'sdir'].includes(signature)) {
      throw new GitError('Unsupported', 'Unknown mandatory Git index extension', { signature });
    }
    extensions.push({ signature, data: bytes.slice(position + 8, position + 8 + size) });
    position += 8 + size;
  }
  const index = new GitIndex({ version, entries: parsed.entries, extensions });
  if (index.entries.length !== parsed.entries.length) throw new GitError('Corrupt', 'Duplicate Git index path and stage');
  return index;
}

/** Encode canonical entries and preserve uninterpreted extensions until index content changes. */
export async function encodeIndex(index, { algorithm = 'sha1' } = {}) {
  let version = index.version;
  if (version === 2 && index.entries.some(entry => entry.intentToAdd || entry.skipWorktree || entry.extendedFlags)) version = 3;
  const entryBytes = encodeIndexEntries(index.entries, { version, hashLength: algorithm === 'sha256' ? 32 : 20 });
  const extensions = index.dirty
    ? index.extensions.filter(extension => !['TREE', 'EOIE', 'IEOT', 'FSMN', 'UNTR', 'link'].includes(extension.signature))
    : index.extensions;
  if (index.dirty && index.extensions.some(extension => extension.signature === 'link')) {
    throw new GitError('Unsupported', 'A split index must be expanded before editing');
  }
  const length = 12 + entryBytes.length + extensions.reduce((sum, extension) => sum + 8 + extension.data.length, 0);
  const body = new Uint8Array(length);
  body.set(encoder.encode('DIRC'));
  const view = new DataView(body.buffer);
  view.setUint32(4, version);
  view.setUint32(8, index.entries.length);
  body.set(entryBytes, 12);
  let position = 12 + entryBytes.length;
  for (const extension of extensions) {
    if (!/^[\x20-\x7e]{4}$/u.test(extension.signature)) throw new GitError('Corrupt', 'Invalid index extension signature');
    body.set(encoder.encode(extension.signature), position);
    view.setUint32(position + 4, extension.data.length);
    body.set(extension.data, position + 8);
    position += extension.data.length + 8;
  }
  const checksum = digestBytes(await hashBytes(body, { algorithm }));
  const output = new Uint8Array(length + checksum.length);
  output.set(body);
  output.set(checksum, length);
  return output;
}

export const parseIndex = decodeIndex;
export const writeIndex = encodeIndex;
export { decodeTreeCache, encodeTreeCache, decodeResolveUndo, encodeResolveUndo } from './index-file-extensions.js';

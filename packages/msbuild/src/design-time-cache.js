import { createHash } from 'node:crypto';
import { readFile, stat, readdir } from 'node:fs/promises';
import { excludedEvaluationDirectories } from './design-time-inputs.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

/** Hash each dependency once per lookup; a bounded reverse index invalidates all affected contexts. */
export class DesignTimeCache {
  constructor({ maxEntries = 128, maxFileBytes = 16777216, maxInputs = 4096, fingerprint = null } = {}) {
    Object.assign(this, { maxEntries, maxFileBytes, maxInputs });
    this.entries = new Map();
    this.reverse = new Map();
    this.fingerprint = fingerprint ?? (async path => {
      let info;
      try { info = await stat(path); }
      catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
      if (info.isDirectory()) {
        const entries = await readdir(path, { withFileTypes: true });
        if (entries.length > 100000) throw new Error('Evaluation directory entry limit exceeded');
        return entries.filter(entry => !(entry.isDirectory() && excludedEvaluationDirectories.has(entry.name)))
          .map(entry => (entry.isDirectory() ? 'd:' : entry.isSymbolicLink() ? 'l:' : 'f:') + entry.name).sort().join('\0');
      }
      if (!info.isFile() || info.size > this.maxFileBytes) throw new Error('Evaluation input size limit exceeded: ' + path);
      return `${info.size}:${info.mtimeMs}:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
    });
  }
  key(request) { return JSON.stringify(stable(request)); }
  async get(request) {
    const key = this.key(request), entry = this.entries.get(key);
    if (!entry) return null;
    for (const [path, hash] of entry.inputs) {
      let current;
      try { current = await this.fingerprint(path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current !== hash) { this.invalidate(path); return null; }
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  async set(request, value, paths) {
    const unique = [...new Set(paths)];
    if (unique.length > this.maxInputs) throw new Error('Evaluation dependency limit exceeded');
    const inputs = new Map();
    for (const path of unique) inputs.set(path, await this.fingerprint(path));
    const key = this.key(request);
    this.delete(key);
    while (this.entries.size >= this.maxEntries) this.delete(this.entries.keys().next().value);
    this.entries.set(key, { value, inputs });
    for (const path of inputs.keys()) {
      if (!this.reverse.has(path)) this.reverse.set(path, new Set());
      this.reverse.get(path).add(key);
    }
    return value;
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    for (const path of entry.inputs.keys()) {
      const keys = this.reverse.get(path);
      keys?.delete(key);
      if (!keys?.size) this.reverse.delete(path);
    }
    this.entries.delete(key);
  }
  invalidate(path) { for (const key of [...this.reverse.get(path) ?? []]) this.delete(key); }
  clear() { this.entries.clear(); this.reverse.clear(); }
}

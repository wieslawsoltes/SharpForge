import { stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Explicit-input fast check. Projects with arbitrary side-effecting targets must opt out. */
export class FastUpToDateCheck {
  constructor({ fingerprint = null } = {}) {
    this.records = new Map();
    this.fingerprint = fingerprint ?? (async path => {
      const info = await stat(path);
      if (!info.isFile() || info.size > 134217728) throw new Error('Up-to-date input file exceeds limit');
      return { modified: info.mtimeMs, size: info.size, hash: createHash('sha256').update(await readFile(path)).digest('hex') };
    });
  }
  async capture(paths) {
    if (!Array.isArray(paths) || paths.length > 20000) throw new Error('Up-to-date item limit exceeded');
    const items = new Map();
    for (const path of new Set(paths)) items.set(path, await this.fingerprint(path));
    return items;
  }
  async record(key, { inputs, outputs, properties = {} }) {
    if (!outputs.length) throw new Error('A fast up-to-date record requires outputs');
    this.records.set(key, { inputs: await this.capture(inputs), outputs: await this.capture(outputs), properties: JSON.stringify(properties) });
  }
  async check(key, { inputs, outputs, properties = {}, enabled = true }) {
    if (!enabled) return { upToDate: false, reason: 'Fast check disabled; native targets will decide' };
    const record = this.records.get(key);
    if (!record) return { upToDate: false, reason: 'No successful build baseline' };
    if (record.properties !== JSON.stringify(properties)) return { upToDate: false, reason: 'Global properties changed' };
    for (const [kind, paths] of [['input', inputs], ['output', outputs]]) {
      const baseline = record[kind + 's'];
      if (new Set(paths).size !== baseline.size) return { upToDate: false, reason: kind + ' set changed' };
      for (const path of paths) {
        const previous = baseline.get(path);
        if (!previous) return { upToDate: false, reason: 'New ' + kind + ': ' + path };
        let current;
        try { current = await this.fingerprint(path); }
        catch (error) { if (error.code === 'ENOENT') return { upToDate: false, reason: 'Missing ' + kind + ': ' + path }; throw error; }
        if (current.hash !== previous.hash || current.modified !== previous.modified) return { upToDate: false, reason: 'Changed ' + kind + ': ' + path };
      }
    }
    return { upToDate: true, reason: 'All declared inputs, outputs and global properties match the last successful build' };
  }
  invalidate(key) { this.records.delete(key); }
}

import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { hashObject } from '../hash.js';
import { applyDelta } from './delta.js';

/** Resolve deltas against the current pack or a thin-pack ODB, spooling unresolved data when supplied. */
export class PackResolver {
  constructor({ odb, staging, algorithm = 'sha1', signal, maxDepth = 128, maxObjectBytes = 64 * 1024 * 1024,
    maxMemoryBytes = 64 * 1024 * 1024, onObject, journalId = globalThis.crypto.randomUUID() } = {}) {
    this.odb = odb;
    this.staging = staging;
    this.algorithm = algorithm;
    this.signal = signal;
    this.maxDepth = maxDepth;
    this.maxObjectBytes = maxObjectBytes;
    this.maxMemoryBytes = maxMemoryBytes;
    this.onObject = onObject;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(journalId)) throw new GitError('Unsafe', 'Invalid pack staging journal identifier');
    this.prefix = `tmp/pack-${journalId}/`;
    this.byOffset = new Map();
    this.byOid = new Map();
    this.memory = new Map();
    this.memoryBytes = 0;
    this.pending = new Map();
    this.waitOid = new Map();
    this.waitOffset = new Map();
    this.ready = [];
    this.entries = [];
  }

  async object(oid) {
    if (this.memory.has(oid)) return this.memory.get(oid);
    if (this.odb && await this.odb.has(oid, { signal: this.signal })) return this.odb.read(oid, { signal: this.signal });
    return null;
  }

  async store(entry, type, data, depth) {
    checkCancelled(this.signal);
    checkLimit(depth, this.maxDepth, 'Pack delta chain');
    const oid = await hashObject(type, data, { algorithm: this.algorithm });
    const metadata = { offset: entry.offset, end: entry.end, crc: entry.crc, oid, type, size: data.length, depth };
    if (this.odb) {
      const actual = await this.odb.write(type, data, { signal: this.signal });
      if (actual !== oid) throw new GitError('Corrupt', 'Object database uses a different object format');
    } else if (!this.memory.has(oid)) {
      this.memoryBytes = checkLimit(this.memoryBytes + data.length, this.maxMemoryBytes, 'Pack object memory');
      this.memory.set(oid, { oid, type, data, size: data.length });
    }
    this.byOffset.set(entry.offset, metadata);
    this.byOid.set(oid, metadata);
    this.entries.push(metadata);
    this.schedule(this.waitOid, oid);
    this.schedule(this.waitOffset, entry.offset);
    await this.onObject?.({ ...metadata, data });
    return metadata;
  }

  async accept(entry) {
    if (entry.type) return this.store(entry, entry.type, entry.data, 0);
    if (await this.resolve(entry)) return;
    const pending = { ...entry, data: null, key: `${this.prefix}${entry.offset}` };
    if (this.staging) await this.staging.set(pending.key, entry.data, { signal: this.signal });
    else {
      this.memoryBytes = checkLimit(this.memoryBytes + entry.data.length, this.maxMemoryBytes, 'Pending delta memory');
      pending.data = entry.data;
    }
    this.pending.set(entry.offset, pending);
    const waiting = entry.baseOffset !== undefined ? this.waitOffset : this.waitOid;
    const key = entry.baseOffset ?? entry.baseOid;
    const dependents = waiting.get(key) ?? [];
    dependents.push(pending);
    waiting.set(key, dependents);
  }

  schedule(waiting, key) {
    const entries = waiting.get(key);
    if (!entries) return;
    this.ready.push(...entries);
    waiting.delete(key);
  }

  async resolve(entry) {
    const baseEntry = entry.baseOffset !== undefined ? this.byOffset.get(entry.baseOffset) : this.byOid.get(entry.baseOid);
    const baseOid = baseEntry?.oid ?? entry.baseOid;
    if (!baseOid) return false;
    const base = await this.object(baseOid);
    if (!base) return false;
    const delta = entry.data ?? await this.staging.get(entry.key, { signal: this.signal });
    if (!delta) throw new GitError('Corrupt', 'Pending pack delta disappeared');
    const depth = (baseEntry?.depth ?? 0) + 1;
    checkLimit(depth, this.maxDepth, 'Pack delta chain');
    const data = applyDelta(base.data, delta, { maxObjectBytes: this.maxObjectBytes, signal: this.signal });
    await this.store(entry, base.type, data, depth);
    if (entry.key && this.staging) await this.staging.delete(entry.key, { signal: this.signal });
    if (entry.key && !this.staging) this.memoryBytes -= delta.length;
    return true;
  }

  async finish() {
    for (let cursor = 0; cursor < this.ready.length; cursor++) {
      const entry = this.ready[cursor];
      if (!this.pending.has(entry.offset)) continue;
      if (!await this.resolve(entry)) throw new GitError('Corrupt', 'Resolved delta base is missing');
      this.pending.delete(entry.offset);
    }
    if (this.pending.size) throw new GitError('Corrupt', 'Pack has missing or cyclic delta bases', { count: this.pending.size });
    this.entries.sort((left, right) => left.offset - right.offset);
    return { entries: this.entries, objects: this.odb ? undefined : [...this.memory.values()] };
  }

  async cleanup() {
    if (!this.staging) return;
    for (const entry of this.pending.values()) await this.staging.delete(entry.key);
  }
}

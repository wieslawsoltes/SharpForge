import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { hashObject } from '../hash.js';
import { objectLinks } from '../remote-graph.js';

/** Canonical provider fallback. Snapshot-only providers must advertise the unsupported byte-preservation boundary. */
export class RestGitTransport {
  constructor({ provider, algorithm = 'sha1', maxObjects = 100_000, maxBytes = 256 * 1024 * 1024 }) {
    this.provider = provider;
    this.algorithm = algorithm;
    this.maxObjects = maxObjects;
    this.maxBytes = maxBytes;
  }

  async capabilities() {
    const capabilities = await this.provider.getCapabilities();
    if (!capabilities.canonicalObjects || capabilities.objectFormat !== this.algorithm) {
      throw new GitError('Unsupported', 'Provider REST API cannot preserve canonical Git objects; use its snapshot operations', {
        algorithm: this.algorithm, capabilities
      });
    }
    return capabilities;
  }

  async listRefs(options = {}) { return this.provider.listRefs(options); }

  async fetch({ odb, wants, signal, onProgress }) {
    await this.capabilities();
    const seen = new Set();
    const queue = [...wants];
    let totalBytes = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      checkCancelled(signal);
      const oid = queue[cursor];
      if (seen.has(oid)) continue;
      checkLimit(seen.size + 1, this.maxObjects, 'REST fetch objects');
      seen.add(oid);
      const exists = await odb.has(oid, { signal });
      const object = exists ? await odb.read(oid, { signal }) : await this.provider.getObject(oid, { signal });
      const actual = await hashObject(object.type, object.data, { algorithm: this.algorithm });
      if (actual !== oid) throw new GitError('Corrupt', 'Provider object content differs from the advertised ID', { oid });
      totalBytes = checkLimit(totalBytes + object.data.length, this.maxBytes, 'REST fetched bytes');
      if (!exists) await odb.write(object.type, object.data, { signal });
      queue.push(...objectLinks(object, { algorithm: this.algorithm }));
      onProgress?.({ phase: 'rest-fetch', completed: seen.size, bytes: totalBytes });
    }
    return { count: seen.size, bytes: totalBytes };
  }

  async push({ odb, updates, atomic = true, signal, confirmation }) {
    const capabilities = await this.capabilities();
    if (atomic && !capabilities.atomicPush) throw new GitError('Unsupported', 'Provider REST transport does not support atomic ref updates');
    const uploaded = new Set();
    const visiting = new Set();
    const stack = updates.filter(update => update.newOid).map(update => ({ oid: update.newOid, visited: false }));
    while (stack.length) {
      checkCancelled(signal);
      const current = stack.pop();
      if (uploaded.has(current.oid)) continue;
      const object = await odb.read(current.oid, { signal });
      if (!current.visited) {
        if (visiting.has(current.oid)) throw new GitError('Corrupt', 'Cyclic object graph');
        checkLimit(visiting.size + uploaded.size, this.maxObjects, 'REST pushed objects');
        visiting.add(current.oid);
        stack.push({ ...current, visited: true });
        for (const oid of objectLinks(object, { algorithm: this.algorithm })) if (!uploaded.has(oid)) stack.push({ oid, visited: false });
        continue;
      }
      const result = await this.provider.writeObject({ ...object, oid: current.oid }, { signal });
      if ((typeof result === 'string' ? result : result.oid) !== current.oid) throw new GitError('Corrupt', 'Provider rewrote canonical object bytes');
      uploaded.add(current.oid);
      visiting.delete(current.oid);
    }
    const result = await this.provider.updateRefs(updates, { atomic, signal, confirmation });
    return { updates: result, objects: uploaded.size };
  }
}

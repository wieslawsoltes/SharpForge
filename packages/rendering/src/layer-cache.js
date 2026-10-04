import {resourceIdentity} from './layer-raster-key.js';

/** LRU raster cache keys include content versions, never placement transforms. */
export class LayerCache {
  constructor({maxBytes = 64 * 1024 * 1024, resources} = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid layer byte budget');
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.dependencies = new Map();
    this.bytes = 0;
    this.rasterizations = 0;
    this.hits = 0;
    this.closed = false;
    this.unsubscribe = resources?.subscribe(event => this.invalidateResource(event.handle));
  }

  get(key, version) {
    const entry = this.entries.get(key);
    if (!entry || entry.version !== version) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.value;
  }

  getOrCreate(key, {version, bytes, create, destroy = value => value.destroy?.(), resources = []}) {
    if (this.closed) throw new Error('Layer cache is disposed');
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) throw new RangeError('Layer exceeds cache budget');
    const existing = this.get(key, version);
    if (existing !== null) return existing;
    const value = create();
    this.invalidate(key);
    while (this.bytes + bytes > this.maxBytes) this.invalidate(this.entries.keys().next().value);
    this.entries.set(key, {value, version, bytes, destroy, resources});
    for (const handle of resources) {
      const users = this.dependencies.get(resourceIdentity(handle)) ?? new Set();
      users.add(key);
      this.dependencies.set(resourceIdentity(handle), users);
    }
    this.bytes += bytes;
    this.rasterizations++;
    return value;
  }

  invalidate(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    for (const handle of entry.resources) {
      const users = this.dependencies.get(resourceIdentity(handle));
      users?.delete(key);
      if (!users?.size) this.dependencies.delete(resourceIdentity(handle));
    }
    entry.destroy(entry.value);
  }

  invalidateResource(handle) {
    for (const key of [...(this.dependencies.get(resourceIdentity(handle)) ?? [])]) this.invalidate(key);
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    for (const key of this.entries.keys()) this.invalidate(key);
    this.dependencies.clear();
  }
}

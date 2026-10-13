const kinds = new Set(['brush', 'pen', 'geometry', 'image', 'font', 'glyphRun', 'layer', 'effect']);

function createSession() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Supply a unique resource session token when crypto.randomUUID is unavailable');
  return globalThis.crypto.randomUUID();
}

/** Application-owned retained descriptions; handles cannot cross table/session boundaries. */
export class ResourceTable {
  constructor({session = createSession(), retirement, maxResources = 65536, onChange} = {}) {
    if (typeof session !== 'string' || !session.length || session.length > 128) throw new TypeError('Resource session must be a bounded unique string');
    this.session = session;
    this.retirement = retirement;
    this.maxResources = maxResources;
    this.entries = [];
    this.free = [];
    this.listeners = new Set(onChange ? [onChange] : []);
    this.closed = false;
    this.version = 0;
    this.liveCount = 0;
  }

  register(kind, data, {dispose, rebuild} = {}) {
    if (this.closed) throw new Error('Resource table is disposed');
    if (!kinds.has(kind)) throw new TypeError(`Unsupported resource kind: ${kind}`);
    if (data === undefined || data === null) throw new TypeError('Resource data is required');
    if (this.liveCount >= this.maxResources) throw new RangeError('Resource table limit exceeded');
    const id = this.free.length ? this.free.pop() : this.entries.length;
    const generation = (this.entries[id]?.generation ?? 0) + 1;
    const handle = Object.freeze({id, generation, session: this.session});
    this.entries[id] = {handle, generation, kind, data, dispose, rebuild, references: 1, version: 1, retired: false};
    this.liveCount++;
    this.changed(handle, 'register');
    return handle;
  }

  entry(handle, kind) {
    if (!Number.isSafeInteger(handle?.id) || handle.id < 0 || !Number.isSafeInteger(handle?.generation) || handle.generation < 1) {
      throw new TypeError('Malformed rendering resource handle');
    }
    const entry = handle?.session === this.session && this.entries[handle.id];
    if (!entry || entry.retired || entry.generation !== handle.generation) {
      throw new TypeError('Stale, released, or foreign rendering resource handle');
    }
    if (kind && entry.kind !== kind) throw new TypeError(`Expected ${kind}; found ${entry.kind}`);
    return entry;
  }

  resolve(handle, kind) { return this.entry(handle, kind).data; }
  getVersion(handle) { return this.entry(handle).version; }

  retain(handle) {
    const entry = this.entry(handle);
    if (entry.references === Number.MAX_SAFE_INTEGER) throw new RangeError('Reference count overflow');
    entry.references++;
    return handle;
  }

  update(handle, data) {
    const entry = this.entry(handle);
    if (data === undefined || data === null) throw new TypeError('Resource data is required');
    entry.data = data;
    entry.version++;
    this.changed(handle, 'update');
    return handle;
  }

  release(handle, ticket) {
    const entry = this.entry(handle);
    if (--entry.references) return Promise.resolve(false);
    entry.retired = true;
    this.liveCount--;
    this.changed(handle, 'release');
    const destroy = () => {
      entry.dispose?.(entry.data);
      entry.data = null;
      this.free.push(handle.id);
      return true;
    };
    if (ticket && this.retirement) this.retirement.use(entry, ticket);
    if (this.retirement) return this.retirement.retire(entry, destroy);
    return Promise.resolve(ticket?.done).then(destroy);
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  changed(handle, reason) {
    this.version++;
    for (const callback of this.listeners) callback({handle, reason, version: this.version});
  }

  async rebuild(context) {
    for (const entry of this.entries) {
      if (entry && !entry.retired) await entry.rebuild?.(entry.data, context);
    }
  }

  descriptions() {
    return this.entries.filter(entry => entry && !entry.retired).map(entry => ({
      handle: entry.handle, kind: entry.kind, version: entry.version, data: entry.data
    }));
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    const pending = [];
    for (const entry of this.entries) {
      if (!entry || entry.retired) continue;
      entry.references = 1;
      pending.push(this.release(entry.handle));
    }
    this.listeners.clear();
    await Promise.all(pending);
  }
}

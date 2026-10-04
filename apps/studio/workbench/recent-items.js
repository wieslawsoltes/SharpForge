import {WorkbenchEvents, assertId} from './events.js';

/** Stable MRU ordering; pinned entries survive eviction and missing sources are removed explicitly. */
export class RecentItems extends WorkbenchEvents {
  constructor({storage, key = 'sharpforge.workbench.recent.v1', limit = 40, onError = () => {}} = {}) {
    super();
    this.storage = storage;
    this.key = key;
    this.limit = limit;
    this.onError = onError;
    this.items = [];
    try {
      const value = JSON.parse(storage?.getItem(key) ?? 'null');
      if (value?.version === 1 && Array.isArray(value.items)) this.items = value.items.filter(item =>
        typeof item.uri === 'string' && ['file', 'project'].includes(item.kind)).slice(0, 200);
    } catch (error) { onError(error); }
  }
  save() {
    try { this.storage?.setItem(this.key, JSON.stringify({version: 1, items: this.items})); }
    catch (error) { this.onError(error); }
    this.emit(this.list());
  }
  add({uri, label = uri, kind = 'file', workspaceId}) {
    assertId(uri, 'Recent item URI');
    if (!['file', 'project'].includes(kind)) throw new TypeError('Invalid recent item kind');
    const previous = this.items.find(item => item.uri === uri && item.kind === kind);
    this.items = this.items.filter(item => item !== previous);
    this.items.unshift({uri, label, kind, workspaceId, pinned: previous?.pinned ?? false});
    let count = 0;
    this.items = this.items.filter(item => item.pinned || ++count <= this.limit);
    this.save();
  }
  pin(uri, pinned = true) { const item = this.items.find(entry => entry.uri === uri); if (item) { item.pinned = pinned; this.save(); } }
  remove(uri) { this.items = this.items.filter(item => item.uri !== uri); this.save(); }
  list(kind) { return this.items.filter(item => !kind || item.kind === kind).sort((left, right) => Number(right.pinned) - Number(left.pinned)); }
  async prune(exists) {
    const retained = [];
    for (const item of this.items) if (await exists(item)) retained.push(item);
    this.items = retained;
    this.save();
  }
}

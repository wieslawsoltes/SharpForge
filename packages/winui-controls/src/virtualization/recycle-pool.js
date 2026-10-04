/** A key belongs to one active container. Clearing is mandatory before a recycled container changes identity. */
export class RecyclePool {
  constructor({ create, prepare = () => {}, clear = () => {}, dispose = container => container.remove?.(),
    maximumRetained = 256 } = {}) {
    if (typeof create !== 'function') throw new TypeError('Container factory is required');
    this.create = create;
    this.prepare = prepare;
    this.clear = clear;
    this.disposeContainer = dispose;
    this.maximumRetained = maximumRetained;
    this.active = new Map();
    this.free = new Map();
    this.identity = new WeakMap();
    this.retained = 0;
    this.disposed = false;
  }
  acquire(key, item, index, template = 'default') {
    if (this.disposed) throw new Error('RecyclePool has been disposed');
    const current = this.active.get(key);
    if (current) {
      if (current.template !== template) this.release(key);
      else {
        const previousIndex = current.index;
        current.index = index;
        current.item = item;
        this.prepare(current.container, { key, item, index, previousIndex, recycled: false });
        return current.container;
      }
    }
    const free = this.free.get(template);
    const container = free?.pop() ?? this.create(template);
    if (free && free.length === 0) this.free.delete(template);
    const recycled = this.identity.has(container);
    if (recycled) this.retained--;
    const entry = { key, item, index, template, container };
    this.active.set(key, entry);
    this.identity.set(container, entry);
    this.prepare(container, { key, item, index, previousIndex: -1, recycled });
    return container;
  }
  release(key) {
    const entry = this.active.get(key);
    if (!entry) return false;
    this.active.delete(key);
    this.clear(entry.container, { key: entry.key, item: entry.item, index: entry.index });
    this.identity.set(entry.container, { key: null, item: null, index: -1, template: entry.template });
    if (this.retained < this.maximumRetained) {
      if (!this.free.has(entry.template)) this.free.set(entry.template, []);
      this.free.get(entry.template).push(entry.container);
      this.retained++;
    } else this.disposeContainer(entry.container);
    return true;
  }
  retainOnly(keys, pinned = new Set()) {
    for (const key of this.active.keys()) if (!keys.has(key) && !pinned.has(key)) this.release(key);
  }
  getIdentity(container) { return this.identity.get(container) ?? null; }
  dispose() {
    if (this.disposed) return;
    for (const entry of this.active.values()) {
      this.clear(entry.container, { key: entry.key, item: entry.item, index: entry.index });
      this.disposeContainer(entry.container);
    }
    for (const values of this.free.values()) for (const container of values) this.disposeContainer(container);
    this.active.clear();
    this.free.clear();
    this.retained = 0;
    this.disposed = true;
  }
}

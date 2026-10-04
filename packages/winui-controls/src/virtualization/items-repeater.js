import { RecyclePool } from './recycle-pool.js';
import { StackLayout } from './items-stack-panel.js';

/** Item sources are indexed adapters: arrays are optional and never eagerly copied. */
export function itemSource(value) {
  if (!Array.isArray(value)) {
    if (!Number.isSafeInteger(value?.count) || typeof value.getAt !== 'function' || typeof value.keyAt !== 'function') {
      throw new TypeError('ItemsSource must supply count, getAt(index), and keyAt(index)');
    }
    return value;
  }
  return { get count() { return value.length; }, getAt: index => value[index],
    keyAt: index => value[index]?.id ?? value[index]?.key ?? index };
}

export class ItemsRepeater {
  constructor({ source, layout, createElement, prepareElement = () => {}, clearElement = () => {},
    disposeElement, onEvent = () => {}, maximumRetained = 256 } = {}) {
    this.source = itemSource(source);
    this.layout = layout ?? new StackLayout({ source: this.source });
    this.onEvent = onEvent;
    this.focusedKey = null;
    this.disposed = false;
    this.pool = new RecyclePool({ create: createElement, maximumRetained, dispose: disposeElement,
      prepare: (container, item) => {
        prepareElement(container, item);
        if (item.previousIndex < 0) onEvent('ElementPrepared', { Element: container, Index: item.index, Key: item.key });
        else if (item.previousIndex !== item.index) onEvent('ElementIndexChanged', {
          Element: container, OldIndex: item.previousIndex, NewIndex: item.index });
      }, clear: (container, item) => {
        onEvent('ElementClearing', { Element: container, Index: item.index, Key: item.key });
        clearElement(container, item);
      } });
  }
  update(viewport) {
    if (this.disposed) throw new Error('ItemsRepeater has been disposed');
    const realization = this.layout.arrange(viewport);
    const keys = new Set();
    for (const item of realization.items) {
      if (keys.has(item.key)) throw new Error('ItemsSource returned duplicate stable keys');
      keys.add(item.key);
    }
    const pinned = this.focusedKey == null ? new Set() : new Set([this.focusedKey]);
    this.pool.retainOnly(keys, pinned);
    const elements = realization.items.map(item => ({ ...item,
      element: this.pool.acquire(item.key, this.source.getAt(item.index), item.index) }));
    return { ...realization, elements };
  }
  getElementIndex(element) { return this.pool.getIdentity(element)?.index ?? -1; }
  tryGetElement(index) {
    if (index < 0 || index >= this.source.count) return null;
    return this.pool.active.get(this.source.keyAt(index))?.container ?? null;
  }
  dispose() { if (!this.disposed) { this.pool.dispose(); this.disposed = true; } }
}

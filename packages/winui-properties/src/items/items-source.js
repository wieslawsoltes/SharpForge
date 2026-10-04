import {ResourceFault} from '../resources/errors.js';
import {cleanupItems} from './bounded-items.js';

/** Enforces Items/ItemsSource exclusivity and forwards collection deltas to the container generator. */
export class ItemsSourceController {
  constructor(generator, {changed = null} = {}) {
    this.generator = generator;
    this.items = Object.freeze([]);
    this.source = null;
    this.subscription = null;
    this.notifyChanged = changed;
  }

  setItemsSource(source, {committed = null} = {}) {
    source ??= null;
    if (source !== null && this.items.length) throw new ResourceFault('SFITEM009', 'Items and ItemsSource cannot both be populated.');
    const items = source === null ? this.items : source.items ?? source;
    const revision = this.generator.revision;
    let failure = null;
    try { this.generator.setItems(items); }
    catch (error) {
      if (this.generator.revision === revision) throw error;
      failure = error;
    }
    cleanupItems([() => this.subscription?.(), () => {
      this.subscription = null;
      this.source = source;
      if (typeof source?.subscribe === 'function') this.subscription = source.subscribe(change => this.changed(change));
    }, () => committed?.(), () => this.notifyChanged?.(this.generator)], 'Switching item source and its observers failed.', failure);
  }

  add(item) {
    if (this.source !== null) throw new ResourceFault('SFITEM010', 'Items is read-only while ItemsSource is set.');
    this.generator.insert(this.items.length, [item]);
    this.items = Object.freeze([...this.items, item]);
    this.notifyChanged?.(this.generator);
  }

  clear() {
    if (this.source !== null) throw new ResourceFault('SFITEM010', 'Items is read-only while ItemsSource is set.');
    this.generator.setItems([]);
    this.items = Object.freeze([]);
    this.notifyChanged?.(this.generator);
  }

  changed(change) {
    const action = String(change.action ?? ['Add', 'Remove', 'Replace', 'Move', 'Reset'][change.Action]).toLowerCase();
    const index = change.index ?? (action === 'remove' ? change.OldStartingIndex : change.NewStartingIndex) ?? change.Index;
    const items = change.items ?? change.NewItems ?? [change.item];
    const oldItems = change.oldItems ?? change.OldItems;
    const handlers = {
      add: () => this.generator.insert(index, items),
      remove: () => this.generator.remove(index, change.count ?? oldItems?.length ?? change.items?.length ?? 1),
      move: () => this.generator.move(change.oldIndex ?? change.OldStartingIndex, change.newIndex ?? change.NewStartingIndex),
      replace: () => this.generator.replace(index, oldItems?.length ?? 1, items),
      reset: () => this.generator.setItems(this.source?.items ?? this.source ?? this.items)
    };
    const handler = handlers[action];
    if (!handler) throw new ResourceFault('SFITEM011', 'Unrecognized collection change action.');
    handler();
    this.notifyChanged?.(this.generator);
  }

  snapshot() {
    return {items: this.items, source: this.source, subscription: this.subscription, generator: this.generator.snapshot()};
  }

  restore(snapshot) {
    if (this.subscription !== snapshot.subscription) this.subscription?.();
    this.items = snapshot.items;
    this.source = snapshot.source;
    this.subscription = snapshot.subscription;
    this.generator.restore(snapshot.generator);
  }

  *retainedValues() {
    if (!this.generator.sourceReference) {
      yield this.source;
      yield* this.items;
    }
    yield* this.generator.retainedValues();
  }

  dispose(options) {
    this.subscription?.();
    this.subscription = null;
    this.source = null;
    this.items = Object.freeze([]);
    this.generator.dispose(options);
  }
}

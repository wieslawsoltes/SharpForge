import {DisposableScope} from '../object-model/disposable-scope.js';
import {ResourceFault} from '../resources/errors.js';
import {boundedItems, cleanupItems} from './bounded-items.js';
import {ItemIdentities} from './item-identities.js';
import {withUIConstruction} from '../object-model/construction-roots.js';

/** Recycling phase callbacks are generation-bound and cannot mutate a container assigned to a later item. */
export class ContainerContentChangingEventArgs {
  constructor(entry, {phase = 0, recycle = false, register}) {
    this.item = entry.item;
    this.itemContainer = entry.container;
    this.itemIndex = entry.index;
    this.phase = phase;
    this.inRecycleQueue = recycle;
    this.handled = false;
    this.register = register;
  }

  registerUpdateCallback(callback, phase = this.phase + 1) {
    if (typeof callback !== 'function' || !Number.isInteger(phase) || phase <= this.phase || phase > 32) {
      throw new ResourceFault('SFITEM001', 'Container update callbacks require a later phase in [1, 32].');
    }
    this.register(callback, phase);
  }
  snapshot() { return {item: this.item, itemContainer: this.itemContainer, itemIndex: this.itemIndex, phase: this.phase,
    inRecycleQueue: this.inRecycleQueue, handled: this.handled, register: this.register}; }
  restore(snapshot) { Object.assign(this, snapshot); }
  *retainedValues() { yield this.item; yield this.itemContainer; }
}

/** O(1) realized-container lookups, bounded recycling and explicit preparation/clear lifetimes. */
export class ItemContainerGenerator {
  constructor({owner, adapter, template = null, templateSelector = null, containerStyle = null,
    styleSelector = null, displayMemberPath = '', maxPool = 256, maxItems = 1000000, schedule = null} = {}) {
    if (!adapter || ![maxPool, maxItems].every(value => Number.isSafeInteger(value) && value >= 0) || !maxItems) {
      throw new TypeError('An item adapter and finite non-negative collection/pool limits are required.');
    }
    this.owner = owner;
    this.adapter = adapter;
    this.identity = adapter.identity ?? (value => value);
    this.itemIdentity = adapter.itemIdentity ?? (value => value);
    this.template = template;
    this.templateSelector = templateSelector;
    this.containerStyle = containerStyle;
    this.styleSelector = styleSelector;
    this.displayMemberPath = displayMemberPath;
    this.maxPool = maxPool;
    this.maxPhaseQueue = Math.min(100000, maxPool * 32 + 1024);
    this.maxItems = maxItems;
    this.schedule = schedule;
    this.items = Object.freeze([]);
    this.sourceReference = null;
    this.identities = new ItemIdentities();
    this.revision = 0;
    this.byIndex = new Map();
    this.byContainer = new Map();
    this.byItem = new Map();
    this.pool = [];
    this.listeners = new Set();
    this.phaseQueue = [];
    this.phaseScheduled = false;
    this.generation = 0;
    this.disposed = false;
  }

  setItems(items) {
    const next = boundedItems(items, this.maxItems);
    this.identities.reset(next.length);
    const indices = [...this.byIndex.keys()];
    const actions = indices.map(index => () => this.recycle(index));
    actions.push(() => { this.items = Object.freeze(next); this.revision++; });
    cleanupItems(actions, 'Replacing items and clearing their containers failed.');
  }

  realize(index) {
    return withUIConstruction(this.adapter, () => this.realizeItem(index), [this.owner]);
  }

  realizeItem(index) {
    this.checkIndex(index);
    const found = this.byIndex.get(index);
    if (found) return found.container;
    const item = this.items[index];
    const isOwnContainer = this.adapter.isItemItsOwnContainer?.(item, this.owner) ?? false;
    const container = isOwnContainer ? item : this.pool.pop() ?? this.adapter.createContainer(this.owner);
    if (this.byContainer.has(this.identity(container))) throw new ResourceFault('SFITEM003', 'A container cannot represent multiple items.');
    const entry = {container, item, index, isOwnContainer, generation: ++this.generation, lifetime: new DisposableScope()};
    try {
      if (!isOwnContainer) {
        this.adapter.resetContainer?.(container);
        this.adapter.setDataContext?.(container, item);
      }
      const template = this.template ?? this.templateSelector?.selectTemplate(item, container) ?? null;
      const style = this.containerStyle ?? this.styleSelector?.selectStyle(item, container) ?? null;
      if (style) entry.lifetime.add(this.adapter.applyStyle(container, style));
      const content = this.adapter.prepareContent?.(container, item, {template, lifetime: entry.lifetime,
        displayMemberPath: this.displayMemberPath, owner: this.owner});
      if (content?.dispose) entry.lifetime.add(content);
      this.adapter.prepareContainerForItem?.(container, item, index, entry.lifetime, this.owner);
      this.addEntry(entry);
      this.contentChanging(entry, 0, false);
      return container;
    } catch (error) {
      this.removeEntry(entry);
      cleanupItems([() => entry.lifetime.dispose(), () => this.adapter.clearContainerForItem?.(container, item, this.owner),
        () => { if (!isOwnContainer) this.adapter.setDataContext?.(container, null); }, () => { if (!isOwnContainer) this.adapter.disposeContainer?.(container); }],
      'Preparing an item container and its cleanup failed.', error);
    }
  }

  recycle(index, {preserveValues = false} = {}) {
    const entry = this.byIndex.get(index);
    if (!entry) return false;
    this.removeEntry(entry);
    entry.generation = ++this.generation;
    if (preserveValues) {
      entry.lifetime.dispose({preserveValues});
      entry.item = null;
      entry.index = -1;
      return true;
    }
    let failure = null;
    try {
      cleanupItems([() => this.contentChanging(entry, 0, true), () => entry.lifetime.dispose(),
        () => this.adapter.clearContainerForItem?.(entry.container, entry.item, this.owner),
        () => { if (!entry.isOwnContainer) this.adapter.resetContainer?.(entry.container); },
        () => { if (!entry.isOwnContainer) this.adapter.setDataContext?.(entry.container, null); }],
      'Recycling an item container failed.');
    } catch (error) { failure = error; }
    entry.item = null;
    entry.index = -1;
    if (!entry.isOwnContainer) {
      if (!failure && this.pool.length < this.maxPool) this.pool.push(entry.container);
      else cleanupItems([() => this.adapter.disposeContainer?.(entry.container)], 'Recycling and disposal failed.', failure);
    }
    if (failure) throw failure;
    return true;
  }

  addEntry(entry) {
    this.byIndex.set(entry.index, entry);
    this.byContainer.set(this.identity(entry.container), entry);
    const key = this.itemIdentity(entry.item);
    let entries = this.byItem.get(key);
    if (!entries) this.byItem.set(key, entries = new Set());
    entries.add(entry);
  }

  removeEntry(entry) {
    this.byIndex.delete(entry.index);
    this.byContainer.delete(this.identity(entry.container));
    const key = this.itemIdentity(entry.item);
    const entries = this.byItem.get(key);
    entries?.delete(entry);
    if (!entries?.size) this.byItem.delete(key);
  }

  containerFromIndex(index) { return this.byIndex.get(index)?.container ?? null; }
  indexFromContainer(container) { return container == null ? -1 : this.byContainer.get(this.identity(container))?.index ?? -1; }
  itemFromContainer(container) { return container == null ? null : this.byContainer.get(this.identity(container))?.item ?? null; }
  containerFromItem(item) { return this.byItem.get(this.itemIdentity(item))?.values().next().value?.container ?? null; }

  insert(index, items) {
    if (!Number.isInteger(index) || index < 0 || index > this.items.length) throw new RangeError('Invalid insertion index.');
    const values = boundedItems(items, this.maxItems - this.items.length);
    this.identities.replace(index, 0, values.length);
    this.items = Object.freeze(this.items.slice(0, index).concat(values, this.items.slice(index)));
    this.revision++;
    this.reindex(entry => entry.index >= index ? entry.index + values.length : entry.index);
  }

  remove(index, count = 1) {
    if (!Number.isInteger(count) || count < 0 || index + count > this.items.length) throw new RangeError('Invalid removal count.');
    if (!count && Number.isInteger(index) && index >= 0 && index <= this.items.length) return;
    this.checkIndex(index);
    this.replace(index, count, []);
  }

  replace(index, count, items) {
    if (!Number.isInteger(index) || index < 0 || index > this.items.length ||
      !Number.isInteger(count) || count < 0 || index + count > this.items.length) throw new RangeError('Invalid replacement range.');
    const values = boundedItems(items, this.maxItems - this.items.length + count);
    this.identities.replace(index, count, values.length);
    const actions = [...this.byIndex.keys()].filter(current => current >= index && current < index + count)
      .map(current => () => this.recycle(current));
    actions.push(() => {
      this.items = Object.freeze(this.items.slice(0, index).concat(values, this.items.slice(index + count)));
      this.revision++;
      this.reindex(entry => entry.index >= index + count ? entry.index + values.length - count : entry.index);
    });
    cleanupItems(actions, 'Replacing items and clearing their containers failed.');
  }

  move(oldIndex, newIndex) {
    this.checkIndex(oldIndex);
    this.checkIndex(newIndex);
    if (oldIndex === newIndex) return;
    this.identities.move(oldIndex, newIndex);
    const next = [...this.items];
    const [item] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, item);
    this.items = Object.freeze(next);
    this.revision++;
    this.reindex(entry => {
      if (entry.index === oldIndex) return newIndex;
      if (oldIndex < newIndex && entry.index > oldIndex && entry.index <= newIndex) return entry.index - 1;
      if (oldIndex > newIndex && entry.index >= newIndex && entry.index < oldIndex) return entry.index + 1;
      return entry.index;
    });
  }

  reindex(indexFor) {
    const entries = [...this.byIndex.values()];
    this.byIndex.clear();
    for (const entry of entries) {
      entry.index = indexFor(entry);
      this.byIndex.set(entry.index, entry);
      this.adapter.indexChanged?.(entry.container, entry.index);
    }
  }

  contentChanging(entry, phase, recycle) {
    const args = new ContainerContentChangingEventArgs(entry, {phase, recycle,
      register: (callback, nextPhase) => {
        if (recycle) throw new ResourceFault('SFITEM004', 'Recycled containers cannot schedule content updates.');
        if (this.phaseQueue.length >= this.maxPhaseQueue) {
          this.phaseQueue = this.phaseQueue.filter(work => work.entry.generation === work.generation);
          if (this.phaseQueue.length >= this.maxPhaseQueue) throw new ResourceFault('SFITEM005', 'Container phase queue limit exceeded.');
        }
        this.phaseQueue.push({entry, generation: entry.generation, phase: nextPhase, callback});
        this.schedulePhases();
      }});
    if (phase === 0) for (const listener of [...this.listeners]) listener(this.owner, args);
    return args;
  }

  flushPhases({maxCallbacks = 1024} = {}) {
    if (!Number.isInteger(maxCallbacks) || maxCallbacks < 1 || maxCallbacks > 100000) throw new RangeError('Invalid phase callback budget.');
    this.phaseQueue.sort((left, right) => left.phase - right.phase);
    const batch = this.phaseQueue.splice(0, maxCallbacks);
    let index = 0;
    try {
      for (; index < batch.length; index++) {
        const work = batch[index];
        if (work.entry.generation !== work.generation || !this.byContainer.has(this.identity(work.entry.container))) continue;
        work.callback(this.owner, this.contentChanging(work.entry, work.phase, false));
      }
    } finally {
      if (index + 1 < batch.length) this.phaseQueue.unshift(...batch.slice(index + 1));
      this.schedulePhases();
    }
    return this.phaseQueue.length;
  }

  schedulePhases() {
    if (!this.schedule || this.phaseScheduled || !this.phaseQueue.length || this.disposed) return;
    this.phaseScheduled = true;
    const callback = () => { this.phaseScheduled = false; this.flushPhases(); };
    const owner = this.owner;
    callback.retainedValues = function* () { yield owner; };
    try { this.schedule(callback, [owner]); }
    catch (error) { this.phaseScheduled = false; throw error; }
  }

  onContentChanging(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  checkIndex(index) {
    if (this.disposed) throw new ResourceFault('SFITEM006', 'The item container generator is disposed.');
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) throw new RangeError('Invalid item index.');
  }

  *retainedValues() {
    yield this.owner;
    if (this.sourceReference) yield this.sourceReference;
    else yield* this.items;
    for (const entry of this.byIndex.values()) yield entry.container;
    yield* this.pool;
    for (const entry of this.byIndex.values()) yield* entry.lifetime.retainedValues();
    for (const work of this.phaseQueue) if (work.entry.generation === work.generation) {
      yield work.callback;
      if (work.callback.retainedValues) yield* work.callback.retainedValues();
    }
    for (const listener of this.listeners) if (listener.retainedValues) yield* listener.retainedValues();
    for (const value of [this.template, this.templateSelector, this.containerStyle, this.styleSelector]) {
      if (value?.retainedValues) yield* value.retainedValues();
    }
  }

  snapshot() {
    return {owner: this.owner, sourceReference: this.sourceReference, template: this.template, templateSelector: this.templateSelector,
      containerStyle: this.containerStyle, styleSelector: this.styleSelector, displayMemberPath: this.displayMemberPath, items: this.items, revision: this.revision, identities: this.identities.snapshot(),
      entries: [...this.byIndex.values()].map(entry => ({entry, item: entry.item, index: entry.index,
        generation: entry.generation, lifetime: entry.lifetime.snapshot()})), pool: [...this.pool],
      listeners: [...this.listeners], phaseQueue: [...this.phaseQueue], phaseScheduled: this.phaseScheduled,
      generation: this.generation, disposed: this.disposed};
  }

  /** Heap and property stores restore the existing containers; no prepare/clear callbacks are replayed. */
  restore(snapshot) {
    const retained = new Set(snapshot.entries.map(value => value.entry));
    for (const entry of this.byIndex.values()) {
      if (!retained.has(entry)) entry.lifetime.dispose({preserveValues: true, clear: false});
    }
    for (const name of ['owner', 'sourceReference', 'template', 'templateSelector', 'containerStyle', 'styleSelector',
      'displayMemberPath', 'generation', 'phaseScheduled', 'disposed']) {
      this[name] = snapshot[name];
    }
    this.items = snapshot.items;
    this.revision = snapshot.revision;
    this.identities.restore(snapshot.identities);
    this.pool = [...snapshot.pool];
    this.listeners = new Set(snapshot.listeners);
    this.phaseQueue = [...snapshot.phaseQueue];
    this.byIndex.clear();
    this.byContainer.clear();
    this.byItem.clear();
    for (const saved of snapshot.entries) {
      Object.assign(saved.entry, {item: saved.item, index: saved.index, generation: saved.generation});
      saved.entry.lifetime.restore(saved.lifetime);
      this.addEntry(saved.entry);
    }
  }

  dispose({preserveValues = false} = {}) {
    if (this.disposed) return;
    const failures = [];
    for (const index of [...this.byIndex.keys()]) {
      try { this.recycle(index, {preserveValues}); } catch (error) { failures.push(error); }
    }
    for (const container of this.pool) {
      if (!preserveValues) try { this.adapter.disposeContainer?.(container); } catch (error) { failures.push(error); }
    }
    this.pool.length = 0;
    this.items = Object.freeze([]);
    this.phaseQueue.length = 0;
    this.listeners.clear();
    this.owner = null;
    this.sourceReference = null;
    this.disposed = true;
    if (failures.length) throw new AggregateError(failures, 'Item generator disposal failed.');
  }
}

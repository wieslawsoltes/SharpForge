import {ResourceFault} from '../resources/errors.js';
import {boundedItems} from './bounded-items.js';

/** A snapshot-backed current-item view with deterministic cancelable navigation and grouped projection. */
export class CollectionView {
  constructor({items = [], groups = [], maxItems = 1000000, maxGroups = 100000} = {}) {
    this.maxItems = maxItems;
    this.maxGroups = maxGroups;
    this.sourceReference = null;
    this.items = [];
    this.groups = groups;
    this.position = -1;
    this.changing = new Set();
    this.changed = new Set();
    this.collectionChanged = new Set();
    this.disposed = false;
    this.reset(items, groups);
  }

  get currentItem() { return this.items[this.position] ?? null; }
  get currentPosition() { return this.position; }
  get isCurrentBeforeFirst() { return this.position < 0; }
  get isCurrentAfterLast() { return this.position >= this.items.length; }
  get count() { return this.items.length; }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }

  moveCurrentToPosition(position) {
    if (this.disposed) throw new ResourceFault('SFITEM007', 'The collection view is disposed.');
    if (!Number.isInteger(position) || position < -1 || position > this.items.length) throw new RangeError('Invalid current position.');
    if (this.position === position) return position >= 0 && position < this.items.length;
    const event = {cancel: false, isCancelable: true, oldPosition: this.position, newPosition: position,
      oldItem: this.currentItem, newItem: this.items[position] ?? null};
    for (const listener of [...this.changing]) listener(event);
    if (event.cancel) return false;
    this.position = position;
    for (const listener of [...this.changed]) listener(event);
    return position >= 0 && position < this.items.length;
  }

  moveCurrentTo(item) { return this.moveCurrentToPosition(this.items.indexOf(item)); }
  moveCurrentToFirst() { return this.moveCurrentToPosition(this.items.length ? 0 : -1); }
  moveCurrentToLast() { return this.moveCurrentToPosition(this.items.length - 1); }
  moveCurrentToNext() { return this.moveCurrentToPosition(Math.min(this.items.length, this.position + 1)); }
  moveCurrentToPrevious() { return this.moveCurrentToPosition(Math.max(-1, this.position - 1)); }

  reset(items, groups = []) {
    const next = boundedItems(items, this.maxItems);
    const nextGroups = boundedItems(groups, this.maxGroups);
    const current = this.currentItem;
    const oldPosition = this.position;
    const hadCurrent = oldPosition >= 0 && oldPosition < this.items.length;
    const position = hadCurrent ? next.indexOf(current) : oldPosition >= this.items.length ? next.length : -1;
    const changed = oldPosition !== position || current !== (next[position] ?? null);
    const event = {cancel: false, isCancelable: false, oldPosition, newPosition: position, oldItem: current, newItem: next[position] ?? null};
    if (changed) for (const listener of [...this.changing]) listener(event);
    this.items = Object.freeze(next);
    this.groups = Object.freeze(nextGroups);
    this.position = position;
    for (const listener of [...this.collectionChanged]) listener({action: 'reset', items: next, groups});
    if (changed) for (const listener of [...this.changed]) listener(event);
  }

  onCurrentChanging(listener) { this.changing.add(listener); return () => this.changing.delete(listener); }
  onCurrentChanged(listener) { this.changed.add(listener); return () => this.changed.delete(listener); }
  subscribe(listener) { this.collectionChanged.add(listener); return () => this.collectionChanged.delete(listener); }

  snapshot() {
    return {sourceReference: this.sourceReference, items: this.items, groups: this.groups, position: this.position, changing: [...this.changing],
      changed: [...this.changed], collectionChanged: [...this.collectionChanged], disposed: this.disposed};
  }

  restore(snapshot) {
    this.sourceReference = snapshot.sourceReference;
    this.items = snapshot.items;
    this.groups = snapshot.groups;
    this.position = snapshot.position;
    this.changing = new Set(snapshot.changing);
    this.changed = new Set(snapshot.changed);
    this.collectionChanged = new Set(snapshot.collectionChanged);
    this.disposed = snapshot.disposed;
  }

  *retainedValues() {
    if (this.sourceReference) yield this.sourceReference;
    else {
      yield* this.items;
      for (const group of this.groups) yield group.group;
    }
    for (const listeners of [this.changing, this.changed, this.collectionChanged]) {
      for (const listener of listeners) if (listener.retainedValues) yield* listener.retainedValues();
    }
  }

  dispose() {
    this.disposed = true;
    this.items = [];
    this.sourceReference = null;
    this.groups = [];
    this.position = -1;
    this.changing.clear();
    this.changed.clear();
    this.collectionChanged.clear();
  }
}

/** Grouping projects a source using an explicit ItemsPath reader; group headers retain their original data. */
export class CollectionViewSource {
  constructor({source = [], isSourceGrouped = false, itemsPath = 'items', read = null, maxItems = 1000000, maxGroups = 100000} = {}) {
    this.source = source;
    this.isSourceGrouped = isSourceGrouped;
    this.itemsPath = itemsPath;
    this.read = read ?? ((value, key) => value?.[key]);
    this.maxItems = maxItems;
    this.maxGroups = maxGroups;
    this.subscription = null;
    this.groupSubscriptions = new Map();
    this.view = new CollectionView({maxItems, maxGroups});
    this.setSource(source);
  }

  setSource(source) {
    const next = source ?? [];
    const projection = this.project(next);
    this.subscription?.();
    this.subscription = null;
    this.source = next;
    this.applyProjection(projection);
    if (typeof source?.subscribe === 'function') this.subscription = source.subscribe(() => this.refresh());
  }

  refresh() {
    this.applyProjection(this.project(this.source));
  }

  project(input) {
    const source = input.items ?? input;
    if (!source?.[Symbol.iterator]) throw new ResourceFault('SFITEM008', 'CollectionViewSource requires an iterable source.');
    if (!this.isSourceGrouped) return {items: boundedItems(source, this.maxItems), groups: [], observed: new Set()};
    const path = typeof this.itemsPath === 'string' ? this.itemsPath.split('.') : [];
    if (!path.length || this.itemsPath.length > 1024 || path.length > 64 ||
      path.some(member => !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(member))) throw new ResourceFault('SFITEM008', 'Invalid grouped ItemsPath.');
    const items = [];
    const groups = [];
    const observed = new Set();
    for (const group of source) {
      if (groups.length >= this.maxGroups) throw new ResourceFault('SFITEM002', 'Grouped collection group limit exceeded.');
      let children = group;
      for (const member of path) children = this.read(children, member);
      if (!children?.[Symbol.iterator]) throw new ResourceFault('SFITEM008', 'Grouped ItemsPath must resolve to an iterable collection.');
      if (typeof children.subscribe === 'function') observed.add(children);
      const startIndex = items.length;
      for (const child of children) {
        if (items.length >= this.maxItems) throw new ResourceFault('SFITEM002', 'Grouped collection item limit exceeded.');
        items.push(child);
      }
      groups.push(Object.freeze({group, startIndex, count: items.length - startIndex}));
    }
    return {items, groups, observed};
  }

  applyProjection({items, groups, observed}) {
    this.view.reset(items, groups);
    for (const [source, dispose] of this.groupSubscriptions) if (!observed.has(source)) {
      dispose(); this.groupSubscriptions.delete(source);
    }
    for (const source of observed) if (!this.groupSubscriptions.has(source)) {
      this.groupSubscriptions.set(source, source.subscribe(() => this.refresh()));
    }
  }

  snapshot() {
    return {source: this.source, isSourceGrouped: this.isSourceGrouped, itemsPath: this.itemsPath,
      subscription: this.subscription, groupSubscriptions: [...this.groupSubscriptions], view: this.view.snapshot()};
  }

  restore(snapshot) {
    if (this.subscription !== snapshot.subscription) this.subscription?.();
    this.source = snapshot.source;
    this.isSourceGrouped = snapshot.isSourceGrouped;
    this.itemsPath = snapshot.itemsPath;
    this.subscription = snapshot.subscription;
    const retained = new Map(snapshot.groupSubscriptions ?? []);
    for (const [source, dispose] of this.groupSubscriptions) if (retained.get(source) !== dispose) dispose();
    this.groupSubscriptions = retained;
    this.view.restore(snapshot.view);
  }

  *retainedValues() { yield this.source; yield* this.view.retainedValues(); }
  dispose() {
    this.subscription?.(); this.subscription = null; this.source = null;
    for (const dispose of this.groupSubscriptions.values()) dispose();
    this.groupSubscriptions.clear(); this.view.dispose();
  }
}

export class GroupStyle {
  constructor({headerTemplate = null, headerTemplateSelector = null, containerStyle = null,
    headerContainerStyle = null, hidesIfEmpty = false} = {}) {
    Object.assign(this, {headerTemplate, headerTemplateSelector, containerStyle, headerContainerStyle, hidesIfEmpty});
    this.listeners = new Set();
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notifyDefinitionChanged() { for (const listener of [...this.listeners]) listener(); }

  snapshot() {
    return {headerTemplate: this.headerTemplate, headerTemplateSelector: this.headerTemplateSelector,
      containerStyle: this.containerStyle, headerContainerStyle: this.headerContainerStyle,
      hidesIfEmpty: this.hidesIfEmpty, listeners: new Set(this.listeners)};
  }

  restore(snapshot) { Object.assign(this, snapshot, {listeners: new Set(snapshot.listeners)}); }

  *retainedValues() {
    for (const value of [this.headerTemplate, this.headerTemplateSelector, this.containerStyle, this.headerContainerStyle]) {
      yield value;
      if (value?.retainedValues) yield* value.retainedValues();
    }
  }
  dispose() { this.listeners.clear(); }
}

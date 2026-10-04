import {StyleApplication} from '../styles/style-application.js';
import {resourceScopeModel} from '../object-model/resource-adapter-models.js';
import {DisposableScope} from '../object-model/disposable-scope.js';
import {ResourceFault} from '../resources/errors.js';

const controls = 'Microsoft.UI.Xaml.Controls.';
const xaml = 'Microsoft.UI.Xaml.';

function groupRange(groups, first, last, limit) {
  let low = 0, high = groups.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (groups[middle].startIndex < first) low = middle + 1;
    else high = middle;
  }
  const result = [];
  for (let index = Math.max(0, low - 1); index < groups.length; index++) {
    const group = groups[index];
    if (group.startIndex > last) break;
    if (group.startIndex + group.count <= first && group.count) continue;
    if (result.length >= limit) throw new ResourceFault('SFITEM015', 'Visible group header budget exceeded.');
    result.push(group);
  }
  return result;
}

/** Group headers own managed controls and templates independently of the viewport's native placement containers. */
export class GroupHeaderCache {
  constructor(context, owner, {maxHeaders = 2048} = {}) {
    this.context = context;
    this.owner = owner;
    this.maxHeaders = maxHeaders;
    this.entries = new Map();
    this.groups = [];
    this.style = null;
    this.subscription = null;
    this.lookup = null;
    this.range = [];
    this.hidesIfEmpty = null;
  }

  update(view, indices) {
    const groups = view?.groups ?? [];
    const changedGroups = groups !== this.groups;
    if (changedGroups) { this.groups = groups; this.lookup = null; }
    const collection = this.context.read(this.owner, 'GroupStyle');
    const style = this.context.unwrapModel(collection ? this.context.items(collection)[0] : null) ?? null;
    if (style !== this.style) {
      this.subscription?.();
      this.style = style;
      this.subscription = style?.subscribe?.(() => this.context.itemsChanged?.(this.owner)) ?? null;
    }
    const hidesIfEmpty = Boolean(style?.hidesIfEmpty);
    if (changedGroups || this.hidesIfEmpty !== hidesIfEmpty) {
      this.hidesIfEmpty = hidesIfEmpty;
      this.range = groups.flatMap((group, index) => hidesIfEmpty && !group.count ? [] : [{index, ...group}]);
    }
    const first = indices.length ? Math.min(...indices) : 0, last = indices.length ? Math.max(...indices) : 0;
    const visible = groupRange(this.range, first, last, this.maxHeaders);
    const retained = new Set(visible.map(group => group.index));
    for (const [index, entry] of this.entries) if (!retained.has(index)) {
      this.entries.delete(index);
      this.disposeEntry(entry);
    }
    for (const group of visible) this.prepare(group, style);
    return visible.map(group => ({...group, header: this.entries.get(group.index).header}));
  }

  records() {
    return [...this.entries].map(([index, entry]) => ({index, ...this.groups[index], header: entry.header}));
  }

  prepare(group, style) {
    const context = this.context;
    let entry = this.entries.get(group.index);
    if (!entry) {
      const header = context.make(controls + 'GroupItem'), presenter = context.make(controls + 'ContentPresenter');
      entry = {header, presenter, group: group.group, lifetime: new DisposableScope()};
      this.entries.set(group.index, entry);
      context.write(header, 'Content', presenter);
      context.setVisualParent(header, this.owner);
      entry.groupStyle = this.styleApplication(header);
      entry.headerStyle = this.styleApplication(presenter);
      entry.lifetime.add(entry.groupStyle);
      entry.lifetime.add(entry.headerStyle);
    }
    entry.group = group.group;
    context.write(entry.presenter, 'ContentTemplate', style?.headerTemplate ? context.wrapModel(style.headerTemplate, xaml + 'DataTemplate') : null);
    context.write(entry.presenter, 'ContentTemplateSelector', style?.headerTemplateSelector
      ? context.wrapModel(style.headerTemplateSelector, controls + 'DataTemplateSelector') : null);
    context.write(entry.presenter, 'Content', group.group);
    entry.groupStyle.apply(style?.containerStyle ?? null);
    entry.headerStyle.apply(style?.headerContainerStyle ?? null);
  }

  styleApplication(target) {
    const context = this.context;
    return new StyleApplication({target, store: context.storeFor(target), registry: context.propertyRegistry,
      resources: resourceScopeModel(context, target), storeFor: value => context.storeFor(value),
      bind: context.bindSetter, materializeResource: context.materializeResource});
  }

  indexFor(group) {
    const context = this.context;
    const keyOf = value => context.typeOf(value) && typeof value === 'object' && !value.valueType ? context.id(value) : value;
    if (!this.lookup) {
      this.lookup = new Map();
      for (const entry of this.groups) if (!this.lookup.has(keyOf(entry.group))) this.lookup.set(keyOf(entry.group), entry.startIndex);
    }
    return this.lookup.get(keyOf(group)) ?? -1;
  }

  disposeEntry(entry, {preserveValues = false} = {}) {
    const failures = [];
    try { entry.lifetime.dispose({preserveValues}); } catch (error) { failures.push(error); }
    if (!preserveValues) {
      for (const value of [entry.presenter, entry.header]) {
        try {
          this.context.setVisualParent(value, null);
          this.context.templateHostAdapter.dispose?.(value);
        } catch (error) { failures.push(error); }
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Group header disposal failed.');
  }

  snapshot() {
    return {groups: this.groups, style: this.style, subscription: this.subscription, range: this.range, hidesIfEmpty: this.hidesIfEmpty,
      entries: [...this.entries].map(([index, entry]) => ({index, entry, group: entry.group, lifetime: entry.lifetime.snapshot()}))};
  }
  restore(snapshot) {
    const retained = new Set(snapshot.entries.map(value => value.entry));
    for (const entry of this.entries.values()) if (!retained.has(entry)) this.disposeEntry(entry, {preserveValues: true});
    if (this.subscription !== snapshot.subscription) this.subscription?.();
    this.groups = snapshot.groups;
    this.style = snapshot.style;
    this.subscription = snapshot.subscription;
    this.lookup = null;
    this.range = snapshot.range;
    this.hidesIfEmpty = snapshot.hidesIfEmpty;
    this.entries = new Map(snapshot.entries.map(saved => {
      saved.entry.group = saved.group;
      saved.entry.lifetime.restore(saved.lifetime);
      return [saved.index, saved.entry];
    }));
  }
  *retainedValues() {
    yield this.owner;
    for (const entry of this.entries.values()) {
      yield entry.header; yield entry.presenter; yield entry.group;
      yield* entry.lifetime.retainedValues();
    }
  }
  dispose(options) {
    this.subscription?.();
    this.subscription = null;
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.groups = [];
    this.lookup = null;
    this.range = [];
    const failures = [];
    for (const entry of entries) {
      try { this.disposeEntry(entry, options); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Group header cache disposal failed.');
  }
}

import { ControlEvents, ControlError, stateFor, registerFamily, emitChange } from '../policy/events.js';
import { itemText, sourceItems, defaultItemHeight } from './item-source.js';
import { visibleItemRange } from './item-source.js';

/** Owned node graph with iterative traversal and generation-safe asynchronous expansion. */
export class TreeViewModel extends ControlEvents {
  constructor({ roots = [], maximumNodes = 100_000 } = {}) {
    super();
    this.maximumNodes = maximumNodes;
    this.roots = roots;
    this.expanded = new Set();
    this.selected = new Set();
    this.pending = new Map();
    this.disposed = false;
    this.reindex();
  }

  reindex() {
    this.nodes = new Map();
    this.parents = new Map();
    const pending = this.roots.map(node => ({ node, parent: null }));
    while (pending.length) {
      const { node, parent } = pending.pop();
      if (!node || typeof node !== 'object') throw new ControlError('SFUI1610', 'A tree node must be an object');
      if (this.nodes.has(node)) throw new ControlError('SFUI1611', 'Tree nodes cannot be shared or cyclic');
      this.nodes.set(node, node);
      this.parents.set(node, parent);
      if (this.nodes.size > this.maximumNodes) throw new ControlError('SFUI1612', 'Tree node limit exceeded');
      for (const child of node.Children ?? node.children ?? []) pending.push({ node: child, parent: node });
      if (node.IsExpanded) this.expanded.add(node);
      else if (node.IsExpanded === false) this.expanded.delete(node);
    }
    this.selected = new Set([...this.selected].filter(node => this.nodes.has(node)));
    this.expanded = new Set([...this.expanded].filter(node => this.nodes.has(node)));
    this.visibleRows = null;
    this.checkStates = null;
  }

  setRoots(roots) {
    if (!Array.isArray(roots)) throw new ControlError('SFUI1610', 'Tree roots must be an array');
    const previous = this.roots;
    this.roots = roots;
    try { this.reindex(); } catch (error) { this.roots = previous; this.reindex(); throw error; }
  }

  visible() {
    if (this.visibleRows) return this.visibleRows;
    const rows = [];
    const pending = this.roots.map(node => ({ node, depth: 1 })).reverse();
    while (pending.length) {
      const row = pending.pop();
      rows.push(row);
      if (this.expanded.has(row.node)) {
        const children = row.node.Children ?? row.node.children ?? [];
        for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index], depth: row.depth + 1 });
      }
    }
    this.visibleRows = rows;
    return rows;
  }

  expand(node, { load, signal } = {}) {
    if (!this.nodes.has(node)) throw new ControlError('SFUI1613', 'Tree node does not belong to this tree');
    if (this.expanded.has(node)) return;
    const args = this.emit('Expanding', { Node: node, Cancel: false });
    if (args.Cancel) return;
    if (node.HasUnrealizedChildren && load) {
      const generation = {};
      this.pending.set(node, generation);
      return Promise.resolve().then(() => load(node, signal)).then(children => {
        signal?.throwIfAborted();
        if (this.disposed || this.pending.get(node) !== generation) return;
        this.pending.delete(node);
        if (!Array.isArray(children)) throw new ControlError('SFUI1614', 'Tree loader must return an array');
        node.Children = children;
        node.HasUnrealizedChildren = false;
        this.reindex();
        this.expanded.add(node); node.IsExpanded = true;
        this.visibleRows = null;
        this.emit('Changed', { Node: node });
      }).finally(() => { if (this.pending.get(node) === generation) this.pending.delete(node); });
    }
    this.expanded.add(node);
    this.visibleRows = null;
    node.IsExpanded = true;
    this.emit('Changed', { Node: node });
  }

  collapse(node) {
    this.pending.delete(node);
    if (!this.expanded.delete(node)) return;
    node.IsExpanded = false;
    this.visibleRows = null;
    this.emit('Collapsed', { Node: node });
  }

  select(node, { multiple = false, toggle = false, cascade = false } = {}) {
    if (!this.nodes.has(node)) throw new ControlError('SFUI1613', 'Tree node does not belong to this tree');
    const previous = [...this.selected];
    const selecting = !toggle || !this.selected.has(node);
    if (!multiple) this.selected.clear();
    const pending = [node];
    while (pending.length) {
      const current = pending.pop();
      if (selecting) this.selected.add(current);
      else this.selected.delete(current);
      if (cascade) pending.push(...(current.Children ?? current.children ?? []));
    }
    const previouslySelected = new Set(previous);
    this.checkStates = null;
    this.emit('SelectionChanged', { AddedItems: [...this.selected].filter(item => !previouslySelected.has(item)),
      RemovedItems: previous.filter(item => !this.selected.has(item)) });
  }

  checked(node) {
    if (!this.checkStates) {
      const states = new Map();
      for (const current of [...this.nodes.keys()].reverse()) {
        const children = current.Children ?? current.children ?? [];
        let state = children.length ? 0 : this.selected.has(current) ? 1 : 2;
        for (const child of children) state |= states.get(child);
        states.set(current, state);
      }
      this.checkStates = states;
    }
    const state = this.checkStates.get(node);
    return state === 3 ? null : state === 1;
  }

  dispose() { this.disposed = true; this.pending.clear(); super.dispose(); }
  *retainedValues() { yield* this.roots; yield* this.selected; }
  snapshot() {
    if (this.pending.size) throw new ControlError('SFUI1615', 'Cannot snapshot an active tree load');
    return { version: 1, roots: [...this.roots], expanded: [...this.expanded], selected: [...this.selected],
      nodes: [...this.nodes.keys()].map(node => ({ node, children: [...(node.Children ?? node.children ?? [])],
        unrealized: node.HasUnrealizedChildren })) };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1615', 'Invalid tree snapshot');
    this.pending.clear(); this.roots = [...snapshot.roots]; this.expanded = new Set(snapshot.expanded);
    this.selected = new Set(snapshot.selected);
    for (const entry of snapshot.nodes) {
      entry.node.Children = [...entry.children]; entry.node.HasUnrealizedChildren = entry.unrealized;
      entry.node.IsExpanded = this.expanded.has(entry.node);
    }
    this.reindex();
    this.byReference = null;
  }
}

function treeState(context, node) {
  return stateFor(context, node, 'tree', () => ({ source: null, model: null, rows: [], current: 0, converted: new Map(),
    dispose() { this.model?.dispose(); } }));
}

function sceneTreeRoots(context, source, converted) {
  const pending = [...source];
  const nodeFor = reference => {
    if (!reference?.$ref) return reference;
    if (!converted.has(reference.$ref)) {
      const sourceNode = context.nodes.get(reference.$ref);
      if (!sourceNode) throw new ControlError('SFUI1610', 'Tree references a missing node');
      converted.set(reference.$ref, { ...sourceNode.properties, reference, Children: [] });
    }
    return converted.get(reference.$ref);
  };
  const visited = new Set();
  while (pending.length) {
    const reference = pending.pop();
    if (!reference?.$ref || visited.has(reference.$ref)) continue;
    visited.add(reference.$ref);
    if (visited.size > 100_000) throw new ControlError('SFUI1612', 'Tree node limit exceeded');
    const children = context.nodes.get(reference.$ref)?.collections.Children ?? [];
    Object.assign(nodeFor(reference), context.nodes.get(reference.$ref).properties);
    nodeFor(reference).Children = children.map(nodeFor); pending.push(...children);
  }
  for (const key of converted.keys()) if (!visited.has(key)) converted.delete(key);
  return source.map(nodeFor);
}

function renderTree(context, node, element) {
  const state = treeState(context, node);
  const source = sourceItems(context, node, 'RootNodes');
  if (source !== state.source || context.host.modelDirty) {
    state.source = source;
    const roots = sceneTreeRoots(context, source, state.converted);
    if (state.model) state.model.setRoots(roots);
    else state.model = new TreeViewModel({ roots });
    if (!state.subscribed) {
      state.subscribed = true;
    for (const name of ['Expanding', 'Collapsed', 'Changed', 'SelectionChanged']) {
      state.model.on(name, args => {
        if (args.Node?.reference) context.nodes.get(args.Node.reference.$ref).properties.IsExpanded = state.model.expanded.has(args.Node);
        const selected = [...state.model.selected];
        if (name === 'SelectionChanged') {
          node.collections.SelectedNodes = selected.map(value => value.reference ?? value);
          node.collections.SelectedItems = selected.map(value => value.Content ?? value);
          node.properties.SelectedNode = node.collections.SelectedNodes[0] ?? null;
          node.properties.SelectedItem = node.collections.SelectedItems[0] ?? null;
        }
        const payload = { ...args, Node: args.Node?.reference ?? args.Node,
          AddedItems: args.AddedItems?.map(value => value.Content ?? value),
          RemovedItems: args.RemovedItems?.map(value => value.Content ?? value),
          SelectedNodes: selected.map(value => value.reference ?? value) };
        if (name === 'Changed') context.emit(node, 'ExpansionChanged', { Node: payload.Node,
          IsExpanded: state.model.expanded.has(args.Node) });
        if (name !== 'Changed') context.emit(node, name, payload);
        context.invalidate(node.id);
        args.Cancel ||= payload.Cancel;
      });
    }
    }
  }
  state.rows = state.model.visible();
  element.setAttribute('role', 'tree');
  element.setAttribute('aria-multiselectable', String(node.properties.SelectionMode === 2));
  element.style.overflow = 'auto';
  const viewport = element.firstElementChild;
  const height = defaultItemHeight(context, node);
  const range = visibleItemRange(state.rows.length, { scroll: element.scrollTop, extent: element.clientHeight || node.properties.Height || 320,
    itemSize: height });
  Object.assign(viewport.style, { position: 'relative', height: state.rows.length * height + 'px' });
  const children = state.rows.slice(range.first, range.last).map(({ node: item, depth }, localIndex) => {
    const index = range.first + localIndex;
    const row = viewport.children[localIndex] ?? context.document.createElement('div');
    row.dataset.treeIndex = String(index);
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth));
    row.setAttribute('aria-selected', String(state.model.selected.has(item)));
    row.tabIndex = state.current === index ? 0 : -1;
    row.style.paddingInlineStart = (depth - 1) * 20 + 'px';
    Object.assign(row.style, { position: 'absolute', top: index * height + 'px', height: height + 'px', left: '0', right: '0' });
    const expandable = item.HasUnrealizedChildren || (item.Children ?? item.children ?? []).length > 0;
    if (expandable) row.setAttribute('aria-expanded', String(state.model.expanded.has(item)));
    else row.removeAttribute('aria-expanded');
    row.textContent = (expandable ? state.model.expanded.has(item) ? '▾ ' : '▸ ' : '') + itemText(context, item);
    if (node.properties.SelectionMode === 2) row.setAttribute('aria-checked', String(state.model.checked(item) ?? 'mixed'));
    return row;
  });
  context.ordered(viewport, children);
}

function treeEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const state = treeState(context, node);
  const target = event.target.closest?.('[data-tree-index]');
  if (!target) return false;
  let index = Number(target.dataset.treeIndex);
  const item = state.rows[index]?.node;
  if (!item) return false;
  if (event.type === 'keydown' && ['ArrowRight', 'ArrowLeft'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'ArrowRight') {
      state.model.expand(item, { load: context.services?.loadTreeChildren })?.catch(error => context.host.options.onError?.(error));
    } else state.model.collapse(item);
    return true;
  }
  if (event.type === 'keydown' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    index = event.key === 'Home' ? 0 : event.key === 'End' ? state.rows.length - 1
      : Math.max(0, Math.min(state.rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    state.current = index;
    element.scrollTop = index * defaultItemHeight(context, node);
    renderTree(context, node, element);
    element.querySelector(`[data-tree-index="${index}"]`)?.focus();
    context.invalidate(node.id);
    return true;
  }
  if (event.type === 'dblclick') {
    if (state.model.expanded.has(item)) state.model.collapse(item);
    else state.model.expand(item, { load: context.services?.loadTreeChildren })?.catch(error => context.host.options.onError?.(error));
  } else if (event.type === 'click' || event.key === ' ') {
    state.current = index;
    if (node.properties.SelectionMode !== 0) {
      state.model.select(item, { multiple: node.properties.SelectionMode === 2, toggle: true, cascade: node.properties.SelectionMode === 2 });
    }
    context.emit(node, 'ItemInvoked', { InvokedItem: item.Content ?? item, Item: item.Content ?? item, Node: item.reference ?? item });
  }
  return true;
}

export function registerTreeRenderers(registry) {
  registerFamily(registry, 'TreeView', { create(context) {
    const element = context.document.createElement('div');
    element.append(context.document.createElement('div'));
    return element;
  }, render: renderTree, virtualizesItems: true,
    getVisualChildren: () => [],
    invoke(context, node, element, method, args = []) {
      const state = treeState(context, node);
      if (!state.model) renderTree(context, node, element);
      const item = args[0]?.$ref ? state.converted.get(args[0].$ref)
        : state.rows[typeof args[0] === 'number' ? args[0] : state.current]?.node;
      if (method === 'Expand') return state.model.expand(item, { load: context.services?.loadTreeChildren }) ?? true;
      if (method === 'Collapse') { state.model.collapse(item); return true; }
      if (method === 'Select' || method === 'AddToSelection' || method === 'RemoveFromSelection') {
        const selected = state.model.selected.has(item);
        if (method === 'RemoveFromSelection' && !selected || method === 'AddToSelection' && selected) return true;
        state.model.select(item, { multiple: method !== 'Select', toggle: method === 'RemoveFromSelection' }); return true;
      }
      return undefined;
    },
    events: { click: treeEvent, dblclick: treeEvent, keydown: treeEvent, scroll: (context, node) => context.invalidate(node.id) } });
}

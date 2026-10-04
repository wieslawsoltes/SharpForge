import { SelectionModel, SelectionMode } from './selection-model.js';
import { SemanticZoomModel } from './grouping.js';
import { TreeViewModel } from './treeview.js';
import { CONTROLS as C, read, registerMethod, registerGet, registerSet, invokeHost } from '../policy/adapter-helpers.js';

const selectors = ['ListView', 'GridView', 'ItemsView', 'ListBox', 'ComboBox', 'FlipView', 'Primitives.Selector'];

export function managedSelectionModel(context, receiver) {
  const model = context.state(receiver, 'family.selection', () => {
    const value = new SelectionModel({ mode: read(context, receiver, 'SelectionMode', SelectionMode.Single) });
    value.on('selectionChanged', args => {
      context.write(receiver, 'SelectedIndex', value.selectedIndex);
      context.write(receiver, 'SelectedItem', value.selectedItem);
      let selectedValue = value.selectedItem;
      const path = read(context, receiver, 'SelectedValuePath', '');
      for (const part of path ? path.split('.') : []) selectedValue = selectedValue == null ? null : context.read(selectedValue, part);
      context.write(receiver, 'SelectedValue', selectedValue);
      context.write(receiver, 'SelectedItems', context.collection(value.selectedItems, C + 'ItemCollection'));
      context.write(receiver, 'SelectedRanges', value.selectedRanges.map(range => context.allocate(C + 'ItemIndexRange', range)));
      synchronizeCurrentItem(value);
      context.emit(receiver, 'SelectionChanged', args);
    });
    const dispose = value.dispose.bind(value);
    value.dispose = () => { value.viewLink?.dispose?.(); dispose(); };
    return value;
  });
  const source = context.read(receiver, 'ItemsSource') ?? context.read(receiver, 'Items');
  const items = context.items(source);
  const version = context.collectionVersion?.(source);
  if (model.lastSource !== items || model.sourceVersion !== version) {
    model.lastSource = items; model.sourceVersion = version; model.setItems(items);
  }
  const mode = read(context, receiver, 'SelectionMode', SelectionMode.Single);
  if (mode !== model.mode) model.setMode(mode);
  bindCurrentItem(context, receiver, source, model);
  return model;
}

export function synchronizeCurrentItem(model) {
  const link = model.viewLink;
  if (!link || link.syncing || link.view.currentPosition === model.selectedIndex) return;
  link.syncing = true;
  try { link.view.moveCurrentToPosition(model.selectedIndex); }
  finally { link.syncing = false; }
}

function bindCurrentItem(context, receiver, source, model) {
  const enabled = read(context, receiver, 'IsSynchronizedWithCurrentItem', true) !== false;
  const view = enabled ? context.collectionView?.(source) : null;
  if (model.viewLink?.view === view) return;
  model.viewLink?.dispose?.();
  model.viewLink = null;
  if (!view) return;
  const link = { view, syncing: false, dispose: null };
  model.viewLink = link;
  const update = () => {
    if (link.syncing || view.currentPosition === model.selectedIndex) return;
    link.syncing = true;
    try {
      if (view.currentPosition < 0) model.clear();
      else model.selectRange(view.currentPosition, 1, true);
    } finally { link.syncing = false; }
  };
  const lease = view.onCurrentChanged(update);
  link.dispose = typeof lease === 'function' ? lease : () => lease?.dispose?.();
  update();
}

function selectByValue(context, receiver, value) {
  const model = managedSelectionModel(context, receiver);
  const native = context.native(value);
  const index = model.items.findIndex(item => Object.is(context.native(item), native));
  model.select(index);
}

export function registerItemsAdapters(registry) {
  for (const name of selectors) {
    const owner = C + name;
    registerMethod(registry, owner, 'Select', (c, r, args) => managedSelectionModel(c, r).select(Number(c.native(args[0]))));
    registerMethod(registry, owner, 'Deselect', (c, r, args) => managedSelectionModel(c, r).selectRange(Number(c.native(args[0])), 1, false));
    registerMethod(registry, owner, 'IsSelected', (c, r, args) => c.managed(managedSelectionModel(c, r).isSelected(Number(c.native(args[0]))), 'bool'));
    for (const [method, selected] of [['SelectRange', true], ['DeselectRange', false]]) {
      registerMethod(registry, owner, method, (c, r, args) => {
        const range = c.native(args[0]);
        managedSelectionModel(c, r).selectRange(Number(range.FirstIndex), Number(range.Length), selected);
      });
    }
    registerMethod(registry, owner, 'SelectAll', (c, r) => managedSelectionModel(c, r).selectAll());
    registerMethod(registry, owner, 'DeselectAll', (c, r) => managedSelectionModel(c, r).clear());
    registerSet(registry, owner, 'SelectedIndex', (c, r, value) => {
      const model = managedSelectionModel(c, r);
      model.select(Number(c.native(value)));
      c.write(r, 'SelectedIndex', model.selectedIndex);
    });
    registerSet(registry, owner, 'SelectedItem', selectByValue);
    registerSet(registry, owner, 'SelectionMode', (c, r, value) => {
      const model = managedSelectionModel(c, r); model.setMode(Number(c.native(value))); c.write(r, 'SelectionMode', model.mode);
    });
    registerSet(registry, owner, 'ItemsSource', (c, r, value) => {
      c.write(r, 'ItemsSource', value); managedSelectionModel(c, r);
    });
    registerGet(registry, owner, 'SelectedIndex', (c, r) => managedSelectionModel(c, r).selectedIndex);
    registerGet(registry, owner, 'SelectedItem', (c, r) => managedSelectionModel(c, r).selectedItem);
    registerGet(registry, owner, 'SelectedItems', (c, r) => managedSelectionModel(c, r).selectedItems);
    registerGet(registry, owner, 'SelectedRanges', (c, r) => managedSelectionModel(c, r).selectedRanges
      .map(range => c.allocate(C + 'ItemIndexRange', { ...range, LastIndex: range.FirstIndex + range.Length - 1 })));
    for (const method of ['ScrollIntoView', 'ContainerFromIndex', 'ContainerFromItem', 'IndexFromContainer', 'ItemFromContainer']) {
      registerMethod(registry, owner, method, (c, r, args, descriptor) => {
        const result = invokeHost(c, r, method, args.map(value => c.native(value)));
        return descriptor.result === 'void' ? undefined : c.managed(result, descriptor.result);
      });
    }
  }
  registerMethod(registry, C + 'ItemIndexRange', '.ctor', (c, r, args) => {
    const first = Number(c.native(args[0] ?? 0)), length = Number(c.native(args[1] ?? 0));
    if (!Number.isSafeInteger(first) || first < 0 || !Number.isSafeInteger(length) || length < 0) throw new RangeError('Invalid item index range');
    return c.allocate(C + 'ItemIndexRange', { FirstIndex: first, Length: length, LastIndex: first + length - 1 });
  }, { kind: 'constructor' });
  registerTreeAdapters(registry);
  registerMethod(registry, C + 'ItemsView', 'StartBringItemIntoView', (context, receiver, args) => {
    invokeHost(context, receiver, 'StartBringItemIntoView', args.map(value => context.native(value)));
  });
  registerMethod(registry, C + 'SemanticZoom', 'ToggleActiveView', (context, receiver) => {
    const model = context.state(receiver, 'family.semanticZoom', () => {
      const value = new SemanticZoomModel({ capture: () => context.read(receiver, 'GroupAnchor') });
      value.on('ViewChangeStarted', args => context.emit(receiver, 'ViewChangeStarted', args));
      value.on('ViewChangeCompleted', args => {
        context.write(receiver, 'IsZoomedInViewActive', value.active);
        context.write(receiver, 'GroupAnchor', value.anchor);
        context.emit(receiver, 'ViewChangeCompleted', args);
      });
      return value;
    });
    model.active = read(context, receiver, 'IsZoomedInViewActive', true);
    model.canChange = read(context, receiver, 'CanChangeViews', true);
    model.toggle();
  });
}

export function managedTreeModel(context, receiver) {
  const model = context.state(receiver, 'family.tree', () => {
    const value = new TreeViewModel();
    for (const name of ['Expanding', 'Collapsed', 'Changed', 'SelectionChanged']) value.on(name, args => {
      if (args.Node?.reference) context.write(args.Node.reference, 'IsExpanded', value.expanded.has(args.Node));
      if (name === 'SelectionChanged') {
        const selected = [...value.selected];
        context.write(receiver, 'SelectedNodes', context.collection(selected.map(node => node.reference), C + 'ItemCollection'));
        context.write(receiver, 'SelectedItems', context.collection(selected.map(node => node.Content), C + 'ItemCollection'));
        context.write(receiver, 'SelectedNode', selected[0]?.reference ?? null);
        context.write(receiver, 'SelectedItem', selected[0]?.Content ?? null);
      }
      const payload = { ...args, Node: args.Node?.reference ?? args.Node,
        AddedItems: args.AddedItems?.map(node => node.Content), RemovedItems: args.RemovedItems?.map(node => node.Content) };
      if (name !== 'Changed') context.emit(receiver, name, payload);
      args.Cancel ||= payload.Cancel;
    });
    value.retainedValues = function* () { for (const node of this.nodes.keys()) { yield node.reference; yield node.Content; } };
    return value;
  });
  const source = context.read(receiver, 'RootNodes');
  const roots = context.items(source);
  model.byReference ??= new Map([...model.nodes.keys()].map(node => [context.id?.(node.reference) ?? node.reference, node]));
  model.setRoots(resolveManagedTree(context, roots, model.byReference));
  return model;
}

const treeModel = managedTreeModel;

function resolveManagedTree(context, roots, converted) {
  const pending = [...roots];
  const key = reference => context.id?.(reference) ?? reference;
  const nodeFor = reference => {
    const identity = key(reference);
    if (!converted.has(identity)) converted.set(identity, { reference, Children: [], Content: context.read(reference, 'Content'),
      IsExpanded: read(context, reference, 'IsExpanded', false), HasUnrealizedChildren: read(context, reference, 'HasUnrealizedChildren', false) });
    return converted.get(identity);
  };
  const visited = new Set();
  while (pending.length) {
    const reference = pending.pop(), identity = key(reference);
    if (visited.has(identity)) continue;
    visited.add(identity);
    if (visited.size > 100_000) throw new RangeError('Tree node limit exceeded');
    const node = nodeFor(reference), children = context.items(context.read(reference, 'Children'));
    node.Content = context.read(reference, 'Content');
    node.IsExpanded = read(context, reference, 'IsExpanded', false);
    node.HasUnrealizedChildren = read(context, reference, 'HasUnrealizedChildren', false);
    node.Children = children.map(nodeFor); pending.push(...children);
  }
  for (const identity of converted.keys()) if (!visited.has(identity)) converted.delete(identity);
  return roots.map(nodeFor);
}

function treeNode(context, model, reference) {
  const identity = context.id?.(reference) ?? reference;
  return model.byReference.get(identity);
}

function registerTreeAdapters(registry) {
  registerGet(registry, C + 'TreeView', 'SelectedNode', (c, r) => [...treeModel(c, r).selected][0]?.reference ?? null);
  registerGet(registry, C + 'TreeView', 'SelectedNodes', (c, r) => [...treeModel(c, r).selected].map(node => node.reference));
  registerGet(registry, C + 'TreeView', 'SelectedItems', (c, r) => [...treeModel(c, r).selected].map(node => node.Content));
  registerSet(registry, C + 'TreeView', 'SelectedNode', (c, r, value) => {
    const model = treeModel(c, r);
    if (c.native(value) == null) {
      const removed = [...model.selected];
      model.selected.clear();
      model.emit('SelectionChanged', { AddedItems: [], RemovedItems: removed });
    } else model.select(treeNode(c, model, value));
  });
  registerMethod(registry, C + 'TreeView', 'Expand', (c, r, args) => {
    const model = treeModel(c, r), result = model.expand(treeNode(c, model, args[0]));
    if (result?.then) return c.task(result, { resultType: 'void' });
  });
  registerMethod(registry, C + 'TreeView', 'Collapse', (c, r, args) => {
    const model = treeModel(c, r); model.collapse(treeNode(c, model, args[0]));
  });
  registerMethod(registry, C + 'TreeView', 'SelectAll', (c, r) => {
    const model = treeModel(c, r);
    for (const node of model.roots) model.select(node, { multiple: true, cascade: true });
  });
}

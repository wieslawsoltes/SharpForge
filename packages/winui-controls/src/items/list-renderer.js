import { SelectionModel, SelectionMode } from './selection-model.js';
import { sourceItems, itemText, navigationIndex, indexOfItem, itemAt, defaultItemHeight } from './item-source.js';
import { ViewportSelectionModel } from './viewport-source.js';
import { ItemsRepeater, createItemsLayout } from '../virtualization/index.js';
import { stateFor, createPart, controlName, emitChange, registerFamily, ControlError } from '../policy/events.js';
import { replaceControlItems } from '../policy/collection-input.js';
import { updateGroups, renderGroupHeaders } from './group-renderer.js';

function selectionState(context, node) {
  return stateFor(context, node, 'items', () => {
    const model = node.properties.$items ? new ViewportSelectionModel() : new SelectionModel();
    const state = { model, source: null, revision: null, selection: undefined, containers: new Map(),
      first: 0, last: 0, columns: 1, search: '', searchAt: 0, drag: -1, repeater: null, layoutKey: '', visualChildren: [],
      dispose() {
        this.layoutController?.abort();
        this.repeater?.layout.dispose?.();
        this.repeater?.dispose();
        model.dispose();
        this.containers.clear();
      } };
    model.on('selectionChanged', args => {
      node.properties.SelectedIndex = model.selectedIndex;
      node.properties.SelectedItem = model.selectedItem;
      node.properties.SelectedValue = model.value(node.properties.SelectedValuePath);
      node.collections.SelectedItems = model.selectedItems;
      node.properties.SelectedRanges = model.selectedRanges;
      state.selection = model.selectedIndex;
      emitChange(context, node, 'SelectionChanged', { ...args, value: model.selectedIndex });
    });
    return state;
  });
}

function createList(context) {
  const root = createPart(context.document, 'div', 'items-root');
  root.append(createPart(context.document, 'div', 'items-header'), createPart(context.document, 'div', 'items-viewport'),
    createPart(context.document, 'div', 'items-footer'));
  return root;
}

function renderContainer(context, node, state, container, item, index, grid) {
  state.containers.set(index, container);
  container.dataset.itemIndex = String(index);
  container.dataset.itemOwner = node.id;
  container.setAttribute('role', grid ? 'gridcell' : 'option');
  container.setAttribute('aria-selected', String(state.model.isSelected(index)));
  container.setAttribute('aria-posinset', String(index + 1));
  container.setAttribute('aria-setsize', String(state.model.count));
  container.tabIndex = index === state.model.selectedIndex || state.model.selectedIndex < 0 && index === 0 ? 0 : -1;
  container.draggable = !!node.properties.CanDragItems || !!node.properties.CanReorderItems;
  container.style.paddingTop = '';
  const managedContainer = state.managedContainers?.get(index);
  if (managedContainer) {
    context.content(container, managedContainer);
    return container;
  }
  const template = context.services?.templates;
  if (node.properties.ItemTemplate && context.services.prepareItemTemplate) {
    context.services.prepareItemTemplate(container, item, node);
  } else if (node.properties.ItemTemplate && template?.renderItem) template.renderItem(node, item, container, index);
  else if (item?.$ref) context.content(container, item);
  else container.textContent = item === undefined && state.source?.records ? 'Loading…'
    : itemText(context, item, node.properties.DisplayMemberPath);
  return container;
}

function realizeItems(context, node, element, state, grid) {
  const properties = node.properties;
  const itemHeight = defaultItemHeight(context, node);
  const itemWidth = Math.max(1, properties.ItemWidth ?? 160);
  const reference = properties.Layout ?? properties.$items?.panel;
  const descriptor = reference?.$ref ? context.nodes.get(reference.$ref) : reference;
  const fallbackType = grid && controlName(node) !== 'ItemsView' ? 'UniformGridLayout' : 'StackLayout';
  const layoutNode = descriptor ? { ...descriptor, properties: { ...descriptor.properties } }
    : { type: fallbackType, properties: { ItemHeight: itemHeight, ItemWidth: itemWidth } };
  if (!(layoutNode.properties.ItemHeight > 0) && !(layoutNode.properties.MinItemHeight > 0)) layoutNode.properties.ItemHeight = itemHeight;
  const layoutKey = JSON.stringify([layoutNode.type, layoutNode.properties]);
  if (!state.repeater || state.layoutKey !== layoutKey) {
    state.layoutController?.abort();
    state.repeater?.layout.dispose?.();
    state.repeater?.dispose();
    state.layoutKey = layoutKey;
    state.layoutError = null;
    state.layoutPrepared = state.layoutPreparing = null;
    state.measuredGroups = null;
    const source = state.model;
    const layout = createItemsLayout(source, layoutNode, { fallbackType,
      aspectRatioAt: index => Number(state.source?.records?.get(index)?.aspectRatio ?? 1) });
    state.repeater = new ItemsRepeater({ source, layout,
      createElement: () => createPart(context.document, 'div', 'item'),
      prepareElement: (container, item) => { container.dataset.itemIndex = String(item.index); },
      clearElement(container, item) {
        state.containers.delete(item.index);
        context.services.clearItemTemplate?.(container, node);
        container.replaceChildren();
      }, onEvent: (name, args) => context.services.itemContainers?.onLifecycle?.(node, name, args) });
  }
  if (state.repeater.layout.measure && state.measuredGroups !== state.groups) {
    for (const first of state.measuredGroupIndices ?? []) {
      if (first < state.model.count) state.repeater.layout.measure(first, { width: itemWidth, height: itemHeight });
    }
    state.measuredGroups = state.groups;
    state.measuredGroupIndices = state.groups?.groups.filter(group => group.length).map(group => group.first) ?? [];
    for (const first of state.measuredGroupIndices) {
      state.repeater.layout.measure(first, { width: itemWidth, height: itemHeight + 24 });
    }
  }
  const focused = context.document.activeElement?.closest?.('[data-item-owner]');
  state.repeater.focusedKey = focused?.dataset.itemOwner === node.id ? state.model.keyAt(Number(focused.dataset.itemIndex)) : null;
  state.containers.clear();
  const width = element.clientWidth || properties.Width || 320;
  const height = element.clientHeight || properties.Height || 320;
  if (!prepareLayout(context, node, state, width)) return;
  const realization = state.repeater.update({ x: element.scrollLeft, y: element.scrollTop, width, height });
  state.realized = realization.elements.map(item => ({ ...item, item: state.model.getAt(item.index) }));
  prepareManagedContainers(context, node, state);
  state.columns = realization.columns ?? (grid ? Math.max(1, Math.floor(width / itemWidth)) : 1);
  state.visualChildren = realization.elements.map(item => state.managedContainers.get(item.index)?.$ref
    ?? state.model.getAt(item.index)?.$ref).filter(Boolean);
  const viewport = element.children[1];
  Object.assign(viewport.style, { position: 'relative', width: realization.extent.width + 'px', height: realization.extent.height + 'px' });
  for (const item of realization.elements) {
    renderContainer(context, node, state, item.element, state.model.getAt(item.index), item.index, grid);
    Object.assign(item.element.style, { position: 'absolute', left: item.x + 'px', top: item.y + 'px',
      width: item.width + 'px', minHeight: item.height + 'px', boxSizing: 'border-box' });
  }
  context.ordered(viewport, realization.elements.map(item => item.element));
  if (state.repeater.layout.measure && !(properties.ItemHeight > 0)) {
    for (const item of realization.elements) {
      if (item.element.offsetHeight > 0) {
        state.repeater.layout.measure(item.index, { width: item.width, height: item.element.offsetHeight });
      }
    }
  }
  state.metrics = { HorizontalOffset: element.scrollLeft, VerticalOffset: element.scrollTop,
    ExtentWidth: realization.extent.width, ExtentHeight: realization.extent.height,
    ViewportWidth: width, ViewportHeight: height };
  renderGroupHeaders(context, node, state, element);
}

function prepareLayout(context, node, state, width) {
  if (state.layoutError) throw state.layoutError;
  const layout = state.repeater.layout;
  if (!layout.prepare) return true;
  const revision = node.properties.$items?.revision ?? node.properties.ItemsRevision ?? 0;
  const key = `${width}:${state.model.count}:${revision}:${state.layoutKey}`;
  if (state.layoutPrepared === key) return true;
  if (state.layoutPreparing === key) return false;
  state.layoutController?.abort();
  const controller = new AbortController();
  state.layoutController = controller;
  state.layoutPreparing = key;
  Promise.resolve(layout.prepare(width, { signal: controller.signal })).then(() => {
    if (controller.signal.aborted || state.repeater.layout !== layout) return;
    state.layoutPrepared = key;
    state.layoutPreparing = null;
    context.invalidate(node.id);
  }, error => {
    if (controller.signal.aborted) return;
    state.layoutPreparing = null;
    state.layoutError = error;
    context.invalidate(node.id);
  });
  return false;
}

function prepareManagedContainers(context, node, state) {
  const provider = context.services.itemContainers;
  provider?.realize?.(node, state.realized);
  const indices = state.realized.map(item => item.index);
  const signature = indices.join(',');
  if (!provider?.realize && state.realizationRequest !== signature && context.host.options.onRealizeItems) {
    state.realizationRequest = signature;
    context.host.options.onRealizeItems({ id: node.id, indices });
  }
  const published = new Map();
  for (const record of state.source?.records?.values() ?? []) if (record.container) published.set(record.index, record.container);
  for (const reference of node.collections.$itemContainers ?? []) {
    const metadata = reference?.$ref && context.nodes.get(reference.$ref);
    const index = metadata?.properties.$itemIndex ?? metadata?.$itemIndex;
    if (Number.isInteger(index)) published.set(index, reference);
  }
  state.managedContainers = new Map();
  for (const item of state.realized) {
    const reference = provider?.referenceFor?.(node, item.key, item.index) ?? published.get(item.index);
    if (reference) state.managedContainers.set(item.index, reference);
  }
}

function renderList(context, node, element) {
  const state = selectionState(context, node);
  const source = sourceItems(context, node);
  const properties = node.properties;
  const grid = ['GridView', 'ItemsView'].includes(controlName(node));
  updateGroups(context, node, state, source);
  if (grid && state.groups) throw new ControlError('SFUI1609', 'Grouped headers currently require ListView or ListBox stack layout');
  if (source !== state.source || properties.ItemsRevision !== state.revision || state.itemDescriptor !== properties.$items) {
    state.source = source;
    state.revision = properties.ItemsRevision;
    state.itemDescriptor = properties.$items;
    state.model.silence(() => state.model.setItems(source));
    state.repeater?.layout.sourceChanged?.();
  }
  const mode = properties.SelectionMode ?? SelectionMode.Single;
  if (state.model.mode !== mode) state.model.silence(() => state.model.setMode(mode));
  if (Number.isInteger(properties.SelectedIndex) && properties.SelectedIndex !== state.selection) {
    state.model.silence(() => state.model.select(Math.min(properties.SelectedIndex, source.length - 1)));
    state.selection = state.model.selectedIndex;
  }
  element.setAttribute('role', grid ? 'grid' : 'listbox');
  element.setAttribute('aria-multiselectable', String(mode === SelectionMode.Multiple || mode === SelectionMode.Extended));
  const [header, viewport, footer] = element.children;
  context.content(header, properties.Header);
  context.content(footer, properties.Footer);
  header.hidden = properties.Header == null;
  footer.hidden = properties.Footer == null;
  element.style.overflow = 'auto';
  realizeItems(context, node, element, state, grid);
}

function clickItem(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const target = event.target.closest?.('[data-item-index]');
  if (target?.dataset.itemOwner !== node.id) return false;
  const index = Number(target.dataset.itemIndex);
  const state = selectionState(context, node);
  state.model.select(index, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey, additive: event.ctrlKey || event.metaKey });
  node.properties.CurrentItemIndex = index;
  if (node.properties.IsItemClickEnabled || node.properties.IsItemInvokedEnabled) {
    context.emit(node, controlName(node) === 'ItemsView' ? 'ItemInvoked' : 'ItemClick',
      { ClickedItem: itemAt(state.source, index), InvokedItem: itemAt(state.source, index), Index: index });
  }
  return true;
}

function keyItem(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const state = selectionState(context, node);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    state.model.selectAll();
    return true;
  }
  let index = state.model.selectedIndex;
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
    const now = event.timeStamp;
    state.search = now - state.searchAt < 1000 ? state.search + event.key : event.key;
    state.searchAt = now;
    const start = Math.max(0, index + 1);
    const candidates = state.source.records ? [...state.source.records.keys()].sort((left, right) =>
      (left - start + state.source.length) % state.source.length - (right - start + state.source.length) % state.source.length) : null;
    const searchCount = candidates?.length ?? state.source.length;
    for (let offset = 0; offset < searchCount; offset++) {
      const candidate = candidates?.[offset] ?? (start + offset) % state.source.length;
      if (itemText(context, itemAt(state.source, candidate), node.properties.DisplayMemberPath).toLocaleLowerCase()
        .startsWith(state.search.toLocaleLowerCase())) { index = candidate; break; }
    }
  } else {
    index = navigationIndex(event.key, Math.max(0, index), state.model.count, { columns: state.columns,
      rtl: node.properties.FlowDirection === 1, pageSize: Math.max(1, Math.floor(element.clientHeight / defaultItemHeight(context, node))) });
  }
  if (index >= 0 && index !== state.model.selectedIndex) {
    event.preventDefault();
    state.model.select(index, { range: event.shiftKey, additive: event.ctrlKey || event.metaKey });
    scrollItemIntoView(context, node, index);
    context.invalidate(node.id);
    state.containers.get(index)?.focus();
    return true;
  }
  if (event.key === 'Enter' || event.key === ' ') return clickItem(context, node, element, event);
  return false;
}

function dragItem(context, node, element, event) {
  const state = selectionState(context, node);
  const target = event.target.closest?.('[data-item-index]');
  if (target?.dataset.itemOwner !== node.id) return false;
  const index = Number(target.dataset.itemIndex);
  if (event.type === 'dragstart') {
    state.drag = index;
    const args = { Items: state.model.isSelected(index) ? state.model.selectedItems : [itemAt(state.source, index)], Cancel: false };
    context.emit(node, 'DragItemsStarting', args);
    if (args.Cancel) { event.preventDefault(); state.drag = -1; }
  } else if (event.type === 'dragover' && node.properties.CanReorderItems) event.preventDefault();
  else if (event.type === 'drop' && node.properties.CanReorderItems && state.drag >= 0) {
    event.preventDefault();
    if (state.source?.records) {
      const reorder = context.services.itemContainers?.reorder;
      if (reorder) reorder(node, state.drag, index);
      else if (context.host.options.onReorderItems) context.host.options.onReorderItems({ id: node.id, from: state.drag, to: index });
      else throw new ControlError('SFUI1609', 'Sparse item reorder requires an authoritative source mutation callback');
      emitChange(context, node, 'DragItemsCompleted', { FromIndex: state.drag, ToIndex: index, Items: [], CollectionProperty: 'ItemsSource' });
      state.drag = -1;
      return true;
    }
    const items = [...state.source];
    items.splice(index, 0, items.splice(state.drag, 1)[0]);
    const property = node.properties.ItemsSource != null ? 'ItemsSource' : 'Items';
    replaceControlItems(context, node, property, items);
    emitChange(context, node, 'DragItemsCompleted',
      { FromIndex: state.drag, ToIndex: index, Items: items, CollectionProperty: property });
    state.drag = -1;
  }
  return true;
}

export function registerListRenderers(registry) {
  registerFamily(registry, ['ListView', 'GridView', 'ItemsView', 'ListBox'], { create: createList, render: renderList, virtualizesItems: true,
    getSelectionModel,
    getAutomationItems: (context, node) => selectionState(context, node).realized ?? [],
    getScrollMetrics: (context, node) => selectionState(context, node).metrics,
    getVisualChildren: (context, node) => {
      const state = selectionState(context, node);
      return [...state.visualChildren, ...state.groupVisualChildren ?? []];
    },
    invoke(context, node, element, method, args) {
      const state = selectionState(context, node);
      if (!state.source) renderList(context, node, element);
      const index = typeof args?.[0] === 'number' ? args[0] : indexOfItem(state.source, args?.[0]);
      if (method === 'Select') state.model.select(index);
      else if (method === 'AddToSelection') state.model.selectRange(index, 1, true);
      else if (method === 'RemoveFromSelection') state.model.selectRange(index, 1, false);
      else if (method === 'SelectAll') state.model.selectAll();
      else if (method === 'DeselectAll') state.model.clear();
      else if (method === 'GetGroupAnchor') return state.groupAnchor ?? null;
      else if (method === 'RestoreGroupAnchor') {
        let target = state.groups?.indexOfKey(args[0]) ?? -1;
        if (target < 0) target = context.services.itemContainers?.groupIndexFor?.(node, args[0]) ?? -1;
        if (target < 0 && context.host.options.onRestoreGroupAnchor) {
          return context.host.options.onRestoreGroupAnchor({ id: node.id, group: args[0] });
        }
        return target < 0 ? false : scrollItemIntoView(context, node, target);
      }
      else if (method === 'ScrollIntoView' || method === 'StartBringItemIntoView') return scrollItemIntoView(context, node, args[0]);
      else if (method === 'ContainerFromIndex') return managedContainer(context, node, state, args[0]);
      else if (method === 'ContainerFromItem') return managedContainer(context, node, state, indexOfItem(state.source, args[0]));
      else if (method === 'IndexFromContainer' || method === 'ItemFromContainer') {
        const provider = context.services.itemContainers;
        if (!provider?.indexFromContainer) throw new ControlError('SFUI1608', 'Managed item-container queries require a container provider');
        const result = provider.indexFromContainer(node, args[0]);
        return method === 'IndexFromContainer' ? result : state.model.getAt(result);
      }
      else if (method === 'Scroll') {
        const amount = (value, viewport) => [-viewport, -32, 0, viewport, 32][value] ?? 0;
        element.scrollLeft += amount(args[0], element.clientWidth);
        element.scrollTop += amount(args[1], element.clientHeight);
      } else if (method === 'SetScrollPercent') {
        if (args[0] >= 0) element.scrollLeft = args[0] / 100 * Math.max(0, element.scrollWidth - element.clientWidth);
        if (args[1] >= 0) element.scrollTop = args[1] / 100 * Math.max(0, element.scrollHeight - element.clientHeight);
      }
      else return undefined;
      context.invalidate(node.id); return true;
    },
    events: { click: clickItem, keydown: keyItem, scroll: (context, node) => context.invalidate(node.id),
      dragstart: dragItem, dragover: dragItem, drop: dragItem } });
  registerFamily(registry, ['ListViewItem', 'GridViewItem', 'ListBoxItem', 'ItemContainer', 'SelectorBarItem'], {
    create: context => context.document.createElement('div'),
    render(context, node, element) { context.content(element, node.properties.Content); }
  });
}

export function getSelectionModel(context, node) { return selectionState(context, node).model; }

function managedContainer(context, node, state, index) {
  const element = state.repeater?.tryGetElement(index);
  if (!element) return null;
  const item = state.model.getAt(index);
  if (state.managedContainers?.has(index)) return state.managedContainers.get(index);
  const itemNode = item?.$ref ? context.nodes.get(item.$ref) : null;
  if (itemNode && ['ListViewItem', 'GridViewItem', 'ListBoxItem', 'ItemContainer'].includes(controlName(itemNode))) return item;
  const provider = context.services.itemContainers;
  if (!provider?.containerFor) throw new ControlError('SFUI1608', 'Generated containers require a managed item-container provider');
  return provider.containerFor(node, item, index, element);
}

export function scrollItemIntoView(context, node, item) {
  const state = selectionState(context, node);
  const index = typeof item === 'number' ? item : indexOfItem(state.source, item);
  if (index < 0 || index >= state.model.count) return false;
  const element = context.getState(node).familyTemplate?.root ?? context.elements.get(node.id);
  if (!element) return false;
  element.scrollTop = state.repeater?.layout.window?.sizes?.offsetOf(index)
    ?? Math.floor(index / state.columns) * defaultItemHeight(context, node);
  context.invalidate(node.id);
  return true;
}

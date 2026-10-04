import { ItemsRepeater, itemSource } from '../virtualization/items-repeater.js';
import { createItemsLayout } from '../virtualization/layout-factory.js';
import { LinedFlowLayout } from '../virtualization/lined-flow-layout.js';
import { makeElement } from './dom-properties.js';

function resolveSource(context, node) {
  const raw = node.properties.ItemsSource;
  const custom = context.services.resolveItemsSource?.(raw, node);
  if (custom) return itemSource(custom);
  if (raw?.$ref) {
    const source = context.resolve(raw.$ref);
    return itemSource(source?.collections?.Items ?? source?.collections?.$items ?? []);
  }
  return itemSource(raw ?? node.collections.Items ?? node.collections.Children ?? []);
}

function layoutModel(context, node, source) {
  const layout = node.properties.Layout?.$ref ? context.resolve(node.properties.Layout.$ref) : null;
  return createItemsLayout(source, layout ?? node, {
    aspectRatioAt: index => context.services.itemAspectRatio?.(source.getAt(index), node) ?? 1 });
}

function createRepeater(context, node, element, state) {
  const source = resolveSource(context, node);
  const layout = layoutModel(context, node, source);
  state.source = source;
  state.layout = layout;
  state.sourceIdentity = node.properties.ItemsSource ?? node.collections.Items ?? node.collections.Children;
  state.layoutIdentity = node.properties.Layout;
  state.repeater = new ItemsRepeater({ source, layout, createElement: () => makeElement(context, 'div'),
    prepareElement(container, item) {
      const prepared = context.services.prepareItemTemplate?.(container, item.item, node);
      if (prepared === undefined) {
        const value = item.item?.$ref ? context.resolve(item.item.$ref)?.properties : item.item;
        container.textContent = value == null ? '' : typeof value === 'object' ? String(value.Content ?? value.Text ?? '') : String(value);
      }
      container.dataset.itemIndex = item.index;
      container.setAttribute('aria-posinset', String(item.index + 1));
      container.setAttribute('aria-setsize', String(source.count));
    }, clearElement(container) { context.services.clearItemTemplate?.(container, node); container.remove(); },
    onEvent: (event, args) => context.emit(node, event, args) });
  state.dispose = () => { state.controller?.abort(); state.layout?.dispose?.(); state.repeater.dispose(); };
  element.firstChild.scrollTop = state.scrollTop ?? 0;
}

function update(context, node, element) {
  const state = context.getState(node);
  const identity = node.properties.ItemsSource ?? node.collections.Items ?? node.collections.Children;
  if (!state.repeater || state.sourceIdentity !== identity || state.layoutIdentity !== node.properties.Layout) {
    state.dispose?.();
    createRepeater(context, node, element, state);
  }
  const viewport = element.firstChild;
  const dimensions = context.host.getLayout(node.id)?.renderSize;
  const width = Math.max(1, viewport.clientWidth || dimensions?.width || context.root.clientWidth);
  const height = Math.max(1, viewport.clientHeight || dimensions?.height || context.root.clientHeight);
  if (state.layout instanceof LinedFlowLayout && (state.layout.width !== width || state.layout.indexedCount !== state.source.count)) {
    if (state.preparingWidth === width && state.preparingCount === state.source.count) return;
    state.controller?.abort();
    state.controller = new AbortController();
    const controller = state.controller;
    state.preparingWidth = width;
    state.preparingCount = state.source.count;
    state.layout.prepare(width, { signal: controller.signal }).then(() => {
      if (!controller.signal.aborted) { state.preparingWidth = null; context.invalidate(node.id, 'render'); }
    }, error => { if (!controller.signal.aborted) context.host.options.onError(error); });
    return;
  }
  if (state.layout.window && state.layout.window.sizes.count !== state.source.count) state.layout.sourceChanged();
  const view = state.repeater.update({ x: viewport.scrollLeft, y: viewport.scrollTop, width, height });
  state.scrollTop = viewport.scrollTop;
  const content = viewport.firstChild;
  content.style.width = Math.max(width, view.extent.width) + 'px';
  content.style.height = Math.max(height, view.extent.height) + 'px';
  for (const entry of view.elements) Object.assign(entry.element.style, { position: 'absolute',
    left: entry.x + 'px', top: entry.y + 'px', width: entry.width + 'px', height: entry.height + 'px' });
  context.ordered(content, view.elements.map(item => item.element));
}

export function registerVirtualRenderers(registry) {
  registry.register(['ItemsRepeater', 'ItemsStackPanel', 'VirtualizingStackPanel', 'ItemsWrapGrid'], {
    virtualizesItems: true,
    create(context) {
      const element = makeElement(context);
      const viewport = makeElement(context, 'div', { 'data-virtual-viewport': '' });
      Object.assign(viewport.style, { position: 'absolute', inset: '0px', overflow: 'auto', contain: 'strict' });
      const content = makeElement(context);
      content.style.position = 'relative';
      viewport.append(content);
      element.append(viewport);
      return element;
    },
    render: update,
    events: { scroll: update },
    invoke(context, node, element, name, args) {
      const repeater = context.getState(node).repeater;
      if (name === 'GetElementIndex') return repeater.getElementIndex(args[0]);
      if (name === 'TryGetElement') return repeater.tryGetElement(args[0]);
      throw new Error('Unknown ItemsRepeater operation: ' + name);
    }
  }, { override: true });
}

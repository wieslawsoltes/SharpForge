import { createPart, controlName, emitChange, stateFor } from '../policy/events.js';
import { replaceControlItems } from '../policy/collection-input.js';
import { sourceItems, itemText } from '../items/item-source.js';

function tabState(context, node) {
  return stateFor(context, node, 'tabs', () => ({ headers: new Map(), drag: -1 }));
}

function tabItems(context, node) {
  return sourceItems(context, node, controlName(node) === 'Pivot' ? 'Items' : 'TabItems');
}

function tabPart(context, state, key, part) {
  if (!state.headers.has(key)) state.headers.set(key, createPart(context.document, 'button', part));
  return state.headers.get(key);
}

/** Tab headers retain their DOM identity while the selected page changes. */
export function renderTabs(context, node, element) {
  const state = tabState(context, node);
  const properties = node.properties;
  const kind = controlName(node);
  const items = tabItems(context, node);
  const [header, body] = element.children;
  const index = Math.max(0, Math.min(items.length - 1, properties.SelectedIndex ?? 0));
  header.setAttribute('role', 'tablist');
  Object.assign(header.style, { display: 'flex', overflow: 'auto' });
  const buttons = [];
  const keys = new Set();
  appendSlot(context, state, buttons, 'header', properties.TabStripHeader);
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const value = items[itemIndex];
    const item = value?.$ref ? context.nodes.get(value.$ref) : null;
    const key = String(value?.$ref ?? itemIndex) + ':' + itemIndex;
    const button = tabPart(context, state, key, 'tab-header');
    keys.add(key);
    button.dataset.tabIndex = String(itemIndex);
    button.id = `sf-tab-${node.id}-${itemIndex}`;
    button.textContent = String(item?.properties.Header ?? itemText(context, value) ?? `Tab ${itemIndex + 1}`);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(index === itemIndex));
    button.setAttribute('aria-controls', 'sf-tabpanel-' + node.id);
    button.tabIndex = index === itemIndex ? 0 : -1;
    button.hidden = kind === 'Pivot' && !!properties.IsLocked && index !== itemIndex;
    button.draggable = !!properties.CanDragTabs || !!properties.CanReorderTabs;
    buttons.push(button);
    if (kind === 'TabView' && item?.properties.IsClosable !== false) {
      const close = tabPart(context, state, key + ':close', 'tab-close');
      keys.add(key + ':close');
      close.dataset.tabClose = String(itemIndex);
      close.textContent = '×';
      close.setAttribute('aria-label', 'Close ' + button.textContent);
      buttons.push(close);
    }
  }
  if (kind === 'TabView' && properties.IsAddTabButtonVisible !== false) {
    const add = tabPart(context, state, 'add', 'tab-add');
    add.textContent = '+';
    add.setAttribute('aria-label', 'Add tab');
    buttons.push(add);
  }
  appendSlot(context, state, buttons, 'footer', properties.TabStripFooter);
  for (const key of state.headers.keys()) {
    if (!keys.has(key) && !['header', 'footer', 'add'].includes(key)) state.headers.delete(key);
  }
  context.ordered(header, buttons);
  context.content(body, items[index]);
  body.id = 'sf-tabpanel-' + node.id;
  body.setAttribute('role', 'tabpanel');
  body.setAttribute('aria-labelledby', `sf-tab-${node.id}-${index}`);
}

function appendSlot(context, state, buttons, key, value) {
  if (value == null) return;
  if (!state.headers.has(key)) state.headers.set(key, context.document.createElement('div'));
  const element = state.headers.get(key);
  context.content(element, value);
  buttons.push(element);
}

export function selectTab(context, node, index) {
  const items = tabItems(context, node);
  const selected = node.properties.SelectedIndex ?? 0;
  if (node.properties.IsLocked || !items.length || index === selected || index < 0 || index >= items.length) return false;
  const pivot = controlName(node) === 'Pivot';
  if (pivot) {
    context.emit(node, 'PivotItemUnloading', { Item: items[selected] });
    context.emit(node, 'PivotItemLoading', { Item: items[index] });
  }
  node.properties.SelectedIndex = index;
  node.properties.SelectedItem = items[index];
  emitChange(context, node, 'SelectionChanged', { AddedItems: [items[index]], RemovedItems: [items[selected]], value: index });
  if (pivot) {
    context.emit(node, 'PivotItemUnloaded', { Item: items[selected] });
    context.emit(node, 'PivotItemLoaded', { Item: items[index] });
  }
  return true;
}

export function tabEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const items = tabItems(context, node);
  const selected = node.properties.SelectedIndex ?? 0;
  const target = event.target.closest?.('[data-tab-index]');
  const close = event.target.closest?.('[data-tab-close]');
  let index = target ? Number(target.dataset.tabIndex) : selected;
  if (event.type === 'click' && event.target.dataset.part === 'tab-add') {
    context.emit(node, 'AddTabButtonClick', {});
    return true;
  }
  const requestClose = close || event.type === 'auxclick' && event.button === 1 && target
    || event.type === 'keydown' && event.ctrlKey && event.key === 'F4';
  if (requestClose && controlName(node) === 'TabView') {
    event.preventDefault();
    index = close ? Number(close.dataset.tabClose) : index;
    context.emit(node, 'TabCloseRequested', { Item: items[index], Tab: items[index], Index: index });
    return true;
  }
  if (event.type === 'keydown') {
    const direction = node.properties.FlowDirection === 1 ? -1 : 1;
    if (event.ctrlKey && event.key === 'Tab') index = (selected + (event.shiftKey ? -1 : 1) + items.length) % items.length;
    else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      index = (selected + (event.key === 'ArrowRight' ? direction : -direction) + items.length) % items.length;
    } else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = items.length - 1;
    else return false;
    event.preventDefault();
  } else if (event.type !== 'click' || !target) return false;
  const changed = selectTab(context, node, index);
  if (changed && event.type === 'keydown') {
    renderTabs(context, node, element);
    element.querySelector(`[data-tab-index="${index}"]`)?.focus();
  }
  return changed;
}

export function tabDrag(context, node, element, event) {
  if (controlName(node) !== 'TabView') return false;
  const state = tabState(context, node);
  const target = event.target.closest?.('[data-tab-index]');
  const index = Number(target?.dataset.tabIndex);
  const items = tabItems(context, node);
  if (event.type === 'dragstart' && target) {
    const args = { Item: items[index], Tab: items[index], Cancel: false };
    context.emit(node, 'TabDragStarting', args);
    if (args.Cancel) event.preventDefault();
    else state.drag = index;
  } else if (event.type === 'dragover') {
    context.emit(node, 'TabStripDragOver', {});
    if (node.properties.CanReorderTabs && target) event.preventDefault();
  } else if (event.type === 'drop') {
    context.emit(node, 'TabStripDrop', {});
    if (!node.properties.CanReorderTabs || !target || state.drag < 0) return false;
    event.preventDefault();
    const next = [...items];
    next.splice(index, 0, next.splice(state.drag, 1)[0]);
    const property = node.properties.TabItemsSource != null ? 'TabItemsSource' : 'TabItems';
    replaceControlItems(context, node, property, next);
    const selected = node.properties.SelectedIndex ?? 0;
    node.properties.SelectedIndex = selected === state.drag ? index : selected > state.drag && selected <= index ? selected - 1
      : selected < state.drag && selected >= index ? selected + 1 : selected;
    context.emit(node, 'TabDragCompleted', { Item: items[state.drag], FromIndex: state.drag, ToIndex: index,
      Items: next, CollectionProperty: property });
    state.drag = -1;
  } else if (event.type === 'dragend') {
    if (state.drag >= 0 && event.dataTransfer?.dropEffect === 'none') {
      context.emit(node, 'TabDroppedOutside', { Item: items[state.drag], Tab: items[state.drag] });
    }
    state.drag = -1;
  } else return false;
  return true;
}

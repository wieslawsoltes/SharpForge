import { SelectionModel } from './selection-model.js';
import { sourceItems, itemText, visibleItemRange, indexOfItem, itemAt } from './item-source.js';
import { ViewportSelectionModel } from './viewport-source.js';
import { stateFor, registerFamily, createPart, emitChange } from '../policy/events.js';

function comboState(context, node) {
  return stateFor(context, node, 'combo', () => ({ model: node.properties.$items ? new ViewportSelectionModel() : new SelectionModel(),
    source: null, index: -1,
    active: -1, open: false, visualChildren: [], dispose() { this.model.dispose(); } }));
}

function openCombo(context, node, state, open) {
  if (state.open === open) return;
  state.open = open;
  node.properties.IsDropDownOpen = open;
  emitChange(context, node, open ? 'DropDownOpened' : 'DropDownClosed');
}

function choose(context, node, state, index) {
  if (index < 0 || index >= state.source.length) return;
  const previous = state.model.selectedItems;
  state.model.select(index);
  state.index = state.active = index;
  node.properties.SelectedIndex = index;
  node.properties.SelectedItem = itemAt(state.source, index);
  node.properties.SelectedValue = state.model.value(node.properties.SelectedValuePath);
  node.properties.Text = itemText(context, itemAt(state.source, index), node.properties.DisplayMemberPath);
  emitChange(context, node, 'SelectionChanged', { AddedItems: [itemAt(state.source, index)], RemovedItems: previous, value: index });
  openCombo(context, node, state, false);
}

function renderCombo(context, node, element) {
  const state = comboState(context, node);
  const items = sourceItems(context, node);
  if (items !== state.source || state.descriptor !== node.properties.$items) {
    state.source = items;
    state.descriptor = node.properties.$items;
    state.model.setItems(items);
  }
  const [header, editor, button, popup] = element.children;
  const properties = node.properties;
  editor.id = 'sf-combo-editor-' + node.id;
  header.htmlFor = editor.id;
  editor.disabled = button.disabled = properties.IsEnabled === false;
  header.textContent = String(properties.Header ?? '');
  header.hidden = properties.Header == null;
  editor.readOnly = !properties.IsEditable;
  editor.placeholder = properties.PlaceholderText ?? '';
  const index = Math.max(-1, Math.min(items.length - 1, properties.SelectedIndex ?? -1));
  if (index !== state.index) { state.model.select(index); state.index = state.active = index; }
  const selectedItem = itemAt(items, index) ?? properties.SelectedItem;
  const text = properties.IsEditable ? properties.Text ?? itemText(context, selectedItem, properties.DisplayMemberPath)
    : itemText(context, selectedItem, properties.DisplayMemberPath);
  if (editor.value !== text) editor.value = text;
  if (properties.IsDropDownOpen !== undefined && !!properties.IsDropDownOpen !== state.open) {
    openCombo(context, node, state, !!properties.IsDropDownOpen);
  }
  element.style.position = 'relative';
  popup.hidden = !state.open;
  popup.id = 'sf-combo-' + node.id.replace(/[^\w-]/g, '-');
  popup.style.maxHeight = (properties.MaxDropDownHeight || 320) + 'px';
  Object.assign(popup.style, { overflow: 'auto', position: 'absolute', insetInline: '0', top: '100%', zIndex: '100' });
  popup.setAttribute('role', 'listbox');
  editor.setAttribute('role', 'combobox');
  editor.setAttribute('aria-controls', popup.id);
  editor.setAttribute('aria-expanded', String(state.open));
  editor.setAttribute('aria-autocomplete', properties.IsEditable ? 'list' : 'none');
  button.setAttribute('aria-label', state.open ? 'Close options' : 'Open options');
  const viewport = popup.firstElementChild;
  const range = visibleItemRange(items.length, { scroll: popup.scrollTop, extent: properties.MaxDropDownHeight || 320, itemSize: 32 });
  viewport.style.position = 'relative';
  viewport.style.height = items.length * 32 + 'px';
  const desired = Array.from({ length: range.last - range.first }, (_, offset) => range.first + offset);
  context.services.itemContainers?.realize?.(node, desired.map(index => ({ index, key: state.model.keyAt(index),
    item: itemAt(items, index), element: null })));
  const signature = desired.join(',');
  if (items.records && state.realizationRequest !== signature && context.host.options.onRealizeItems) {
    state.realizationRequest = signature;
    context.host.options.onRealizeItems({ id: node.id, indices: desired });
  }
  const children = desired.map((itemIndex, localIndex) => {
    const item = itemAt(items, itemIndex);
    const option = viewport.children[localIndex] ?? context.document.createElement('div');
    option.dataset.comboIndex = String(itemIndex);
    option.id = popup.id + '-' + itemIndex;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(itemIndex === state.index));
    Object.assign(option.style, { position: 'absolute', top: itemIndex * 32 + 'px', height: '32px', left: '0', right: '0' });
    const container = context.services.itemContainers?.referenceFor?.(node, state.model.keyAt(itemIndex), itemIndex)
      ?? items.records?.get(itemIndex)?.container;
    if (container) context.content(option, container);
    else if (properties.ItemTemplate && context.services?.templates?.renderItem) {
      context.services.templates.renderItem(node, item, option, itemIndex);
    } else if (item?.$ref) context.content(option, item);
    else option.textContent = itemText(context, item, properties.DisplayMemberPath);
    return option;
  });
  context.ordered(viewport, children);
  state.visualChildren = desired.map(index => context.services.itemContainers?.referenceFor?.(node, state.model.keyAt(index), index)?.$ref
    ?? items.records?.get(index)?.container?.$ref ?? itemAt(items, index)?.$ref).filter(Boolean);
  if (state.open && state.active >= 0) editor.setAttribute('aria-activedescendant', popup.id + '-' + state.active);
  else editor.removeAttribute('aria-activedescendant');
}

function comboEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const state = comboState(context, node);
  const option = event.target.closest?.('[data-combo-index]');
  if (event.type === 'click' && option) { choose(context, node, state, Number(option.dataset.comboIndex)); return true; }
  if (event.type === 'click' && (event.target.dataset.part === 'combo-toggle' || !node.properties.IsEditable)) {
    openCombo(context, node, state, !state.open);
    return true;
  }
  if (event.type === 'input') {
    node.properties.Text = event.target.value;
    const text = event.target.value;
    const entries = state.source.records ? [...state.source.records].map(([index, record]) => [index, record.item]) : state.source.entries();
    state.active = -1;
    for (const [index, item] of entries) {
      if (itemText(context, item, node.properties.DisplayMemberPath).toLocaleLowerCase().startsWith(text.toLocaleLowerCase())) {
        state.active = index;
        break;
      }
    }
    context.emit(node, 'TextChanged', { Text: text, value: text });
    openCombo(context, node, state, true);
    return true;
  }
  if (event.type === 'focusout' && !element.contains(event.relatedTarget)) { openCombo(context, node, state, false); return true; }
  if (event.type !== 'keydown') return false;
  if (event.key === 'F4' || event.altKey && event.key === 'ArrowDown') {
    event.preventDefault();
    openCombo(context, node, state, !state.open);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const length = state.source.length;
    state.active = event.key === 'Home' ? 0 : event.key === 'End' ? length - 1
      : Math.max(0, Math.min(length - 1, state.active + (event.key === 'ArrowDown' ? 1 : -1)));
    openCombo(context, node, state, true);
    element.lastElementChild.scrollTop = Math.max(0, state.active * 32 - 160);
    context.invalidate(node.id);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (state.open && state.active >= 0) choose(context, node, state, state.active);
    else if (node.properties.IsEditable) emitChange(context, node, 'TextSubmitted', { Text: node.properties.Text ?? '', Handled: false });
  } else if (event.key === 'Escape') openCombo(context, node, state, false);
  else return false;
  return true;
}

export function registerComboRenderer(registry) {
  registerFamily(registry, 'ComboBox', { create(context) {
    const root = context.document.createElement('div');
    const button = createPart(context.document, 'button', 'combo-toggle');
    button.textContent = '▾';
    const popup = createPart(context.document, 'div', 'combo-popup');
    popup.append(context.document.createElement('div'));
    root.append(createPart(context.document, 'label', 'combo-header'), createPart(context.document, 'input', 'combo-editor'), button, popup);
    return root;
  }, render: renderCombo, virtualizesItems: true,
  getSelectionModel: (context, node) => comboState(context, node).model,
  getVisualChildren: (context, node) => comboState(context, node).visualChildren,
  invoke(context, node, element, method, args = []) {
    const state = comboState(context, node);
    if (!state.source) renderCombo(context, node, element);
    if (node.properties.IsEnabled === false) return false;
    if (method === 'Expand' || method === 'Collapse') openCombo(context, node, state, method === 'Expand');
    else if (method === 'Select') choose(context, node, state, typeof args[0] === 'number' ? args[0] : indexOfItem(state.source, args[0]));
    else if (method === 'SetValue' && node.properties.IsEditable) {
      node.properties.Text = String(args[0]);
      context.emit(node, 'TextChanged', { Text: node.properties.Text, value: node.properties.Text });
    } else return undefined;
    context.invalidate(node.id);
    return true;
  }, events: { click: comboEvent, keydown: comboEvent, input: comboEvent, focusout: comboEvent,
    scroll: (context, node) => context.invalidate(node.id) } });
}

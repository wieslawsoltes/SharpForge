import { makeElement, number, shortType } from './dom-properties.js';
import { registerExpanderRenderer } from './expander-renderer.js';

const div = context => makeElement(context);

export function registerLegacyExtended(registry) {
  registry.register('ComboBox', comboBoxRenderer);
  registry.register(['ListView', 'NavigationView'], listRenderer);
  registry.register(['NumberBox', 'CalendarDatePicker', 'TimePicker'], valueRenderer);
  registerExpanderRenderer(registry);
  registry.register('ContentDialog', dialogRenderer);
  registry.register('InfoBar', infoBarRenderer);
  registry.register('TabView', tabRenderer);
  registry.register('ToolTip', { create: context => makeElement(context, 'div', { role: 'tooltip' }),
    render(context, node, element) { context.content(element, node.properties.Content); element.hidden = node.properties.IsOpen === false; } });
  registry.register('Separator', { create: context => makeElement(context, 'div', { role: 'separator' }),
    render(context, node, element) { element.style.background = node.properties.Background ? context.color(node.properties.Background) : 'var(--sf-app-line)'; } });
  registry.register('CommandBar', { create: context => makeElement(context, 'div', { role: 'toolbar' }),
    render: (context, node, element) => context.ordered(element, context.children(node, 'Children')) });
  registry.register('MenuFlyout', { create: context => makeElement(context, 'div', { role: 'menu' }),
    render(context, node, element) {
      context.ordered(element, context.children(node, 'Items'));
      element.classList.add('sf-winui-flyout');
    } });
  registry.register('MenuFlyoutItem', { create: context => makeElement(context, 'button', { type: 'button', role: 'menuitem' }),
    render: (context, node, element) => context.content(element, node.properties.Text),
    events: { click(context, node) { context.emit(node, 'Click'); context.host.hideFlyouts(); } } });
}

const comboBoxRenderer = {
  create: context => makeElement(context, 'select'),
  render(context, node, element) {
    const items = node.collections.Items ?? [];
    const options = [...element.options];
    items.forEach((item, index) => {
      const option = options[index] ?? makeElement(context, 'option');
      const value = item?.$ref ? context.resolve(item.$ref)?.properties.Content : item;
      option.textContent = value == null ? '' : String(value);
      option.value = String(index);
      if (!options[index]) element.append(option);
    });
    for (let index = items.length; index < options.length; index++) options[index].remove();
    element.selectedIndex = node.properties.SelectedIndex ?? -1;
  },
  events: { change(context, node, element) {
    node.properties.SelectedIndex = element.selectedIndex;
    context.emit(node, 'SelectionChanged', { value: element.selectedIndex });
  } }
};

const listRenderer = {
  create: div,
  render(context, node, element) {
    const navigation = shortType(node.type) === 'NavigationView';
    element.setAttribute('role', navigation ? 'navigation' : 'listbox');
    const items = node.collections[navigation ? 'MenuItems' : 'Items'] ?? [];
    const children = items.map((item, index) => {
      const child = item?.$ref ? context.host.ensure(item.$ref) : element.children[index] ?? div(context);
      if (!child) return null;
      if (!item?.$ref) context.content(child, item);
      child.dataset.selectionOwner = node.id;
      child.dataset.selectionIndex = index;
      child.setAttribute('role', 'option');
      child.tabIndex = node.properties.SelectedIndex === index ? 0 : -1;
      child.setAttribute('aria-selected', String(node.properties.SelectedIndex === index));
      return child;
    }).filter(Boolean);
    if (navigation && node.properties.Content?.$ref) children.push(context.host.ensure(node.properties.Content.$ref));
    context.ordered(element, children.filter(Boolean));
  },
  events: { click: selectItem, keydown(context, node, element, event) {
    if (!['Enter', ' '].includes(event.key)) return;
    selectItem(context, node, element, event);
    event.preventDefault();
  } }
};

function selectItem(context, node, element, event) {
  const target = event.target.closest?.('[data-selection-index]');
  if (!target || target.dataset.selectionOwner !== node.id) return;
  node.properties.SelectedIndex = Number(target.dataset.selectionIndex);
  context.emit(node, 'SelectionChanged', { value: node.properties.SelectedIndex });
  context.invalidate(node.id, 'render');
}

const valueRenderer = {
  create(context, node) {
    const type = shortType(node.type);
    return makeElement(context, 'input', { type: type === 'NumberBox' ? 'number' : type === 'TimePicker' ? 'time' : 'date' });
  },
  render(context, node, element) {
    const type = shortType(node.type);
    if (type === 'NumberBox') {
      element.min = number(node.properties.Minimum, -1e9);
      element.max = number(node.properties.Maximum, 1e9);
      element.step = number(node.properties.SmallChange, 1);
      element.value = number(node.properties.Value);
      element.readOnly = !!node.properties.IsReadOnly;
    } else element.value = node.properties[type === 'TimePicker' ? 'Time' : 'Date'] ?? '';
    element.placeholder = node.properties.PlaceholderText ?? '';
  },
  events: { input(context, node, element) {
    if (shortType(node.type) !== 'NumberBox') return;
    const value = Number(element.value);
    if (!Number.isFinite(value)) return;
    node.properties.Value = Math.max(number(node.properties.Minimum, -1e9), Math.min(number(node.properties.Maximum, 1e9), value));
    context.emit(node, 'ValueChanged', { value: node.properties.Value });
  }, change(context, node, element) {
    if (shortType(node.type) === 'NumberBox') return;
    const property = shortType(node.type) === 'TimePicker' ? 'Time' : 'Date';
    node.properties[property] = element.value;
    context.emit(node, property + 'Changed', { value: element.value });
  } }
};

const infoBarRenderer = {
  create(context) {
    const element = div(context);
    element.append(makeElement(context, 'b', { 'data-info-title': '' }), makeElement(context, 'span', { 'data-info-message': '' }),
      makeElement(context, 'button', { type: 'button', 'data-ui-action': 'info-close', 'aria-label': 'Close notification' }),
      makeElement(context, 'div', { 'data-info-content': '' }));
    element.children[2].textContent = '×';
    return element;
  },
  render(context, node, element) {
    element.hidden = !node.properties.IsOpen;
    element.setAttribute('role', node.properties.Severity >= 2 ? 'alert' : 'status');
    element.dataset.severity = String(node.properties.Severity ?? 0);
    element.children[0].textContent = node.properties.Title ?? '';
    element.children[1].textContent = node.properties.Message ?? '';
    element.children[2].hidden = !node.properties.IsClosable;
    context.content(element.children[3], node.properties.Content);
  },
  events: { click(context, node, element, event) {
    if (event.target.closest?.('[data-ui-action]')?.dataset.uiAction !== 'info-close') return;
    node.properties.IsOpen = false;
    context.emit(node, 'Closed');
    context.invalidate(node.id);
  } }
};

const dialogRenderer = {
  create(context) {
    const element = makeElement(context, 'div', { role: 'dialog', 'aria-modal': 'true' });
    const buttons = makeElement(context, 'div', { 'data-dialog-buttons': '' });
    for (const action of ['Primary', 'Secondary', 'Close']) buttons.append(makeElement(context, 'button', {
      type: 'button', 'data-ui-action': 'dialog-' + action }));
    element.append(makeElement(context, 'h2'), makeElement(context, 'div', { 'data-dialog-content': '' }), buttons);
    return element;
  },
  render(context, node, element) {
    element.hidden = !node.properties.IsOpen;
    element.firstChild.textContent = node.properties.Title ?? '';
    context.content(element.children[1], node.properties.Content);
    for (const button of element.lastChild.children) {
      const text = node.properties[button.dataset.uiAction.slice(7) + 'ButtonText'];
      button.textContent = text ?? '';
      button.hidden = !text;
    }
  },
  events: { click(context, node, element, event) {
    const action = event.target.closest?.('[data-ui-action]')?.dataset.uiAction;
    if (!action?.startsWith('dialog-')) return;
    node.properties.IsOpen = false;
    context.emit(node, action.slice(7) + 'ButtonClick');
    context.invalidate(node.id);
  } }
};

const tabRenderer = {
  create(context) {
    const element = div(context);
    element.append(makeElement(context, 'div', { role: 'tablist', 'data-tab-headers': '' }),
      makeElement(context, 'div', { 'data-tab-body': '' }));
    return element;
  },
  render(context, node, element) {
    const headers = [];
    const tabs = [];
    for (const [index, item] of (node.collections.TabItems ?? []).entries()) {
      const tab = context.host.ensure(item.$ref);
      const data = context.resolve(item.$ref);
      if (!tab) continue;
      const header = [...element.firstChild.children].find(value => value.dataset.tabId === item.$ref)
        ?? makeElement(context, 'button', { type: 'button', role: 'tab' });
      Object.assign(header.dataset, { tabId: item.$ref, selectionOwner: node.id, selectionIndex: index });
      header.textContent = String(data?.properties.Header ?? 'Tab ' + (index + 1));
      header.setAttribute('aria-selected', String(index === node.properties.SelectedIndex));
      header.tabIndex = index === node.properties.SelectedIndex ? 0 : -1;
      headers.push(header);
      tab.hidden = index !== node.properties.SelectedIndex;
      tab.setAttribute('role', 'tabpanel');
      if (data?.properties.IsClosable !== false) {
        const close = makeElement(context, 'button', { type: 'button', 'aria-label': 'Close ' + header.textContent });
        close.dataset.closeTab = item.$ref;
        close.textContent = '×';
        headers.push(close);
      }
      tabs.push(tab);
    }
    context.ordered(element.firstChild, headers);
    context.ordered(element.lastChild, tabs);
  },
  events: { click(context, node, element, event) {
    const closing = event.target.closest?.('[data-close-tab]');
    if (closing) { context.emit(context.resolve(closing.dataset.closeTab), 'CloseRequested'); return; }
    selectItem(context, node, element, event);
  } }
};

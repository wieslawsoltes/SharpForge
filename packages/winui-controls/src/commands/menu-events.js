import { controlName, stateFor } from '../policy/events.js';
import { commandCanExecute, executeCommand } from './command.js';
import { overlayManager } from '../overlay/index.js';

export function enabledMenuItems(container) {
  return [...(container?.querySelectorAll('[role^="menuitem"], [role="button"]') ?? [])].filter(item => !item.disabled && !item.hidden
    && item.getAttribute('aria-disabled') !== 'true' && !item.closest('[hidden]')
    && item.closest('[role="menu"],[role="menubar"],[role="toolbar"]') === container);
}

function setOpenState(context, details, open) {
  const id = details.dataset.menuOwner;
  details.open = open;
  details.firstElementChild?.setAttribute('aria-expanded', String(open));
  const node = context.nodes.get(id);
  if (node) {
    stateFor(context, node, 'menu-open', () => ({ open: false })).open = open;
    for (const reference of node.collections.Items ?? []) {
      const element = context.elements.get(reference.$ref);
      if (element) element.hidden = !open;
    }
  }
  const state = context.host.layoutEngine?.states.get(id);
  if (state) { state.data.menuOpen = open; context.invalidate(id); }
}

/** A submenu opens its own level, retains sibling command identity and exposes one roving focus target. */
export function setMenuOpen(context, details, open, { focus = false } = {}) {
  if (open) {
    const container = details.parentElement?.closest('[role="menu"],[role="menubar"]');
    for (const sibling of container?.querySelectorAll('details[data-menu-owner]') ?? []) {
      if (sibling !== details && sibling.parentElement?.closest('[role="menu"],[role="menubar"]') === container) {
        setOpenState(context, sibling, false);
      }
    }
  }
  setOpenState(context, details, open);
  if (focus) {
    const menu = details.lastElementChild;
    const target = open ? enabledMenuItems(menu)[0] : details.firstElementChild;
    target?.focus();
  }
}

function selectMenuItem(context, node, element) {
  const kind = controlName(node);
  if (node.properties.IsEnabled === false || !commandCanExecute(context, node)) return true;
  if (kind === 'ToggleMenuFlyoutItem' || kind === 'RadioMenuFlyoutItem') {
    const next = kind === 'RadioMenuFlyoutItem' || !node.properties.IsChecked;
    if (kind === 'RadioMenuFlyoutItem') {
      const container = element.closest('[role="menu"]');
      for (const sibling of container?.querySelectorAll('[role="menuitemradio"]') ?? []) {
        if (sibling.closest('[role="menu"]') !== container) continue;
        const id = sibling.dataset.menuItemOwner ?? sibling.closest('[data-sf-id]')?.dataset.sfId;
        const other = context.nodes.get(id);
        if (other && other !== node && controlName(other) === kind && other.properties.IsChecked
          && other.properties.GroupName === node.properties.GroupName) {
          other.properties.IsChecked = false;
          context.emit(other, 'Unchecked', { IsChecked: false });
          context.invalidate(other.id);
        }
      }
    }
    if (next !== !!node.properties.IsChecked) {
      node.properties.IsChecked = next;
      context.emit(node, next ? 'Checked' : 'Unchecked', { IsChecked: next });
    }
  }
  executeCommand(context, node);
  context.emit(node, 'Click', {});
  context.invalidate(node.id);
  for (const details of element.closest('[role="menubar"]')?.querySelectorAll('details[data-menu-owner]') ?? []) {
    setMenuOpen(context, details, false);
  }
  overlayManager(context).close().catch(error => context.host.options.onError?.(error));
  return true;
}

function navigateMenu(context, node, element, event) {
  const details = event.target.closest('details[data-menu-owner]');
  const summary = event.target.closest('summary');
  const container = event.target.closest('[role="menu"],[role="menubar"],[role="toolbar"]') ?? element;
  const horizontal = ['menubar', 'toolbar'].includes(container.getAttribute('role'));
  const forward = node.properties.FlowDirection === 1 ? 'ArrowLeft' : 'ArrowRight';
  const backward = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
  if (summary && details && (event.key === (horizontal ? 'ArrowDown' : forward) || event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); setMenuOpen(context, details, true, { focus: true }); return true;
  }
  if (details && !summary && [forward, backward].includes(event.key)
    && context.nodes.get(details.dataset.menuOwner)?.type.endsWith('.MenuBarItem')) {
    const bar = details.parentElement.closest('[role="menubar"]'), headers = enabledMenuItems(bar);
    const index = headers.indexOf(details.firstElementChild);
    const next = headers[(index + (event.key === forward ? 1 : -1) + headers.length) % headers.length];
    if (next) {
      event.preventDefault(); setMenuOpen(context, details, false);
      setMenuOpen(context, next.parentElement, true, { focus: true }); return true;
    }
  }
  if (details && (event.key === 'Escape' || !horizontal && event.key === backward && !summary)) {
    event.preventDefault(); setMenuOpen(context, details, false, { focus: true }); return true;
  }
  const items = enabledMenuItems(container), current = items.indexOf(context.document.activeElement);
  let index = current;
  if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = items.length - 1;
  else if (event.key === (horizontal ? forward : 'ArrowDown')) index = (current + 1) % items.length;
  else if (event.key === (horizontal ? backward : 'ArrowUp')) index = (current - 1 + items.length) % items.length;
  else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    const state = stateFor(context, node, 'menu-typeahead', () => ({ text: '', at: 0 }));
    state.text = event.timeStamp - state.at < 1000 ? state.text + event.key : event.key;
    state.at = event.timeStamp;
    index = items.findIndex(item => item.textContent.trim().toLocaleLowerCase().startsWith(state.text.toLocaleLowerCase()));
  } else return false;
  if (items[index]) {
    event.preventDefault();
    for (const item of items) item.tabIndex = item === items[index] ? 0 : -1;
    items[index].focus();
  }
  return true;
}

export function menuEvent(context, node, element, event) {
  const kind = controlName(node), submenu = kind === 'MenuBarItem' || kind === 'MenuFlyoutSubItem';
  if (node.properties.IsEnabled === false) {
    if (submenu && (event.type === 'click' || event.type === 'keydown')) event.preventDefault();
    return submenu;
  }
  if (event.type === 'pointerover' && submenu && !element.contains(event.relatedTarget)) {
    setMenuOpen(context, element, true); return true;
  }
  if (event.type === 'click' && submenu && event.target.closest('summary') === element.firstElementChild) {
    event.preventDefault(); setMenuOpen(context, element, !element.open); return true;
  }
  if (event.type === 'click' && ['MenuFlyoutItem', 'ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem'].includes(kind)) {
    return selectMenuItem(context, node, element);
  }
  return event.type === 'keydown' ? navigateMenu(context, node, element, event) : false;
}

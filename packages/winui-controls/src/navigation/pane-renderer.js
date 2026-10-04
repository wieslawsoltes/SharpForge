import { controlEventRequester, requestControlEvent } from '../policy/event-requests.js';
import { createPart, controlName, stateFor, emitChange } from '../policy/events.js';
import { renderIconSource } from '../icons/index.js';
import { navigationGeometry, PaneState } from './pane.js';
import { navigationEntries } from './menu-model.js';

function paneState(context, node) {
  return stateFor(context, node, 'navigation', () => {
    const model = new PaneState({ open: node.properties.IsPaneOpen !== false });
    const state = { model, rows: new Map(), entries: [], dom: null, width: 0, height: 0, measured: false, geometry: null, focusKey: null,
      dispose: () => model.dispose() };
    for (const name of ['PaneOpening', 'PaneClosing', 'PaneOpened', 'PaneClosed', 'DisplayModeChanged']) {
      model.on(name, payload => {
        if (name === 'PaneOpened' || name === 'PaneClosed') node.properties.IsPaneOpen = model.open;
        if (name === 'DisplayModeChanged') node.properties.DisplayMode = model.displayMode;
        context.emit(node, name, payload);
        context.invalidate(node.id, 'measure');
      });
    }
    return state;
  });
}

export function createNavigation(context, node) {
  const state = paneState(context, node);
  const root = context.document.createElement('div');
  const pane = createPart(context.document, 'nav', 'navigation-pane');
  const content = createPart(context.document, 'div', 'navigation-content');
  const scrim = createPart(context.document, 'button', 'navigation-dismiss');
  const toggle = createPart(context.document, 'button', 'navigation-toggle');
  scrim.setAttribute('aria-label', 'Close navigation pane');
  toggle.setAttribute('aria-label', 'Toggle navigation pane');
  toggle.textContent = '☰';
  root.append(content, scrim, pane, toggle);
  state.dom = { root, pane, content, scrim, toggle };
  return root;
}

function slot(context, state, key, value) {
  if (!state.rows.has(key)) state.rows.set(key, createPart(context.document, 'div', key));
  const element = state.rows.get(key);
  context.content(element, value);
  return element;
}

function renderEntry(context, state, entry, selected, compact) {
  let element = state.rows.get(entry.key);
  if (!element) {
    element = createPart(context.document, entry.selectable ? 'button' : 'div', 'navigation-item');
    state.rows.set(entry.key, element);
  }
  element.dataset.navigationKey = entry.key;
  element.setAttribute('role', entry.kind.endsWith('Separator') ? 'separator' : entry.selectable ? 'treeitem' : 'presentation');
  element.style.minHeight = (context.services.environment?.TouchMode ? 40 : 32) + 'px';
  element.style.paddingInlineStart = (8 + entry.depth * 20) + 'px';
  if (!entry.selectable) {
    element.textContent = entry.text;
    if (entry.kind.endsWith('Separator')) element.style.borderTop = '1px solid currentColor';
    return element;
  }
  element.disabled = entry.properties.IsEnabled === false;
  element.setAttribute('aria-level', String(entry.depth + 1));
  element.setAttribute('aria-selected', String(selected));
  element.setAttribute('aria-label', entry.text || 'Navigation item');
  element.setAttribute('aria-current', selected ? 'page' : 'false');
  if (entry.children) element.setAttribute('aria-expanded', String(!!entry.properties.IsExpanded));
  else element.removeAttribute('aria-expanded');
  element.tabIndex = state.focusKey === entry.key || !state.focusKey && selected ? 0 : -1;
  const icon = createPart(context.document, 'span', 'navigation-icon');
  if (entry.settings) renderIconSource(context, { Symbol: 'Setting' }, icon);
  else if (entry.properties.Icon) renderIconSource(context, entry.properties.Icon, icon);
  const label = createPart(context.document, 'span', 'navigation-label');
  label.hidden = compact;
  context.content(label, entry.properties.Content ?? entry.text);
  const chevron = createPart(context.document, 'span', 'navigation-expand');
  chevron.dataset.navigationExpand = entry.key;
  chevron.textContent = entry.children ? entry.properties.IsExpanded ? '⌄' : '›' : '';
  chevron.setAttribute('aria-hidden', 'true');
  const badge = createPart(context.document, 'span', 'navigation-badge');
  context.content(badge, entry.properties.InfoBadge);
  badge.hidden = !entry.properties.InfoBadge;
  context.ordered(element, [icon, label, badge, chevron]);
  return element;
}

function menu(context, node, state) {
  const properties = node.properties;
  state.entries = navigationEntries(context, node);
  const compact = state.geometry?.displayMode === 1 && !state.model.open;
  const selectedId = properties.SelectedItem?.$ref;
  const rows = [];
  if (properties.PaneTitle) rows.push(slot(context, state, 'navigation-title', properties.PaneTitle));
  for (const key of ['PaneHeader', 'AutoSuggestBox']) if (properties[key]) rows.push(slot(context, state, key, properties[key]));
  for (const entry of state.entries) {
    const selected = selectedId ? entry.value?.$ref === selectedId : properties.SelectedItem === entry.value
      || entry.key.startsWith('menu:') && entry.depth === 0 && properties.SelectedIndex === entry.index;
    rows.push(renderEntry(context, state, entry, selected, compact));
  }
  if (properties.PaneFooter) rows.push(slot(context, state, 'PaneFooter', properties.PaneFooter));
  if (properties.IsBackButtonVisible === 1 || properties.IsBackButtonVisible === 2
    || properties.IsBackButtonVisible === true || ['Visible', 'Auto'].includes(properties.IsBackButtonVisible)) {
    const back = state.rows.get('back') ?? createPart(context.document, 'button', 'navigation-back');
    state.rows.set('back', back);
    back.textContent = '←';
    back.setAttribute('aria-label', 'Back');
    back.disabled = properties.IsBackEnabled !== true;
    rows.unshift(back);
  }
  if (!rows.some(row => row.tabIndex === 0)) rows.find(row => row.dataset.navigationKey && !row.disabled)?.setAttribute('tabindex', '0');
  const active = new Set(rows);
  for (const [key, row] of state.rows) if (!active.has(row)) state.rows.delete(key);
  context.ordered(state.dom.pane, rows);
  state.dom.pane.setAttribute('role', 'tree');
  state.dom.pane.setAttribute('aria-label', properties.PaneTitle || 'Navigation');
}

function place(element, area) {
  Object.assign(element.style, { position: 'absolute', left: area.x + 'px', top: area.y + 'px',
    width: area.width + 'px', height: area.height + 'px', boxSizing: 'border-box' });
}

function placeNavigation(context, node, state) {
  const dom = state.dom;
  const geometry = state.geometry;
  const templated = !!context.getState(node).familyTemplate?.parts.has('PanePresenter');
  if (!templated) {
    place(dom.pane, geometry.pane);
    place(dom.content, geometry.content);
  } else {
    for (const part of [dom.pane, dom.content]) Object.assign(part.style, { position: 'relative', left: '0px', top: '0px', width: '100%', height: '100%' });
  }
  dom.pane.hidden = geometry.pane.width === 0 || geometry.pane.height === 0;
  Object.assign(dom.pane.style, { zIndex: '2', overflow: 'auto', background: 'Canvas', color: 'CanvasText',
    display: geometry.top ? 'flex' : 'block', whiteSpace: geometry.top ? 'nowrap' : 'normal', paddingTop: geometry.top ? '0' : '40px' });
  place(dom.scrim, geometry.chrome);
  Object.assign(dom.scrim.style, { zIndex: '1', border: '0', background: 'rgb(0 0 0 / 20%)', pointerEvents: 'auto' });
  dom.scrim.hidden = !geometry.overlay;
  dom.toggle.hidden = controlName(node) !== 'NavigationView' || geometry.top || node.properties.IsPaneToggleButtonVisible === false;
  Object.assign(dom.toggle.style, { position: 'absolute', insetInlineStart: '0', top: '0', width: '40px', height: '40px',
    zIndex: '3', pointerEvents: 'auto' });
  dom.toggle.setAttribute('aria-expanded', String(state.model.open));
}

export function renderNavigation(context, node) {
  const state = paneState(context, node);
  state.model.open = node.properties.IsPaneOpen !== false;
  const width = state.measured ? state.width : Number.isFinite(node.properties.Width) ? node.properties.Width : 1008;
  const height = state.measured ? state.height : Number.isFinite(node.properties.Height) ? node.properties.Height : 600;
  state.geometry = navigationGeometry(controlName(node), node.properties, { width, height });
  if (controlName(node) === 'NavigationView') menu(context, node, state);
  else context.content(state.dom.pane, node.properties.Pane);
  context.content(state.dom.content, node.properties.Content);
  placeNavigation(context, node, state);
}

export function navigationAfterLayout(context, node, element, layout) {
  const state = paneState(context, node);
  const area = layout?.renderSize ?? layout?.bounds ?? layout?.rect ?? element.getBoundingClientRect();
  if (!(area.width >= 0) || !(area.height >= 0)) return;
  const changed = state.width !== area.width || state.height !== area.height;
  state.measured = true;
  state.width = area.width;
  state.height = area.height;
  if (controlName(node) === 'NavigationView') {
    const request = controlEventRequester(context) ? (name, payload, options) => requestControlEvent(context, node, name, payload, options) : null;
    Promise.resolve(state.model.adapt(node.properties, state.width, request)).catch(error => { if (error?.name !== 'AbortError') context.host.options.onError?.(error); });
  }
  if (changed) renderNavigation(context, node);
}

export function mountNavigationTemplate(context, node, owner, template) {
  const state = paneState(context, node);
  const paneId = template.parts.get('PanePresenter');
  const contentId = template.parts.get('NavigationContentPresenter');
  if (!paneId || !contentId) return false;
  const pane = context.host.ensure(paneId);
  const content = context.host.ensure(contentId);
  const chrome = context.host.ensure(template.parts.get('PART_BehaviorRoot'));
  context.ordered(pane, [state.dom.pane]);
  const contentRoot = context.nodes.get(contentId)?.templateRoot;
  if (contentRoot) context.content(state.dom.content, { $ref: contentRoot });
  context.ordered(content, [state.dom.content]);
  context.ordered(chrome, [template.root]);
  Object.assign(pane.style, { zIndex: '2' });
  Object.assign(chrome.style, { zIndex: '1', pointerEvents: 'none' });
  template.root.style.pointerEvents = 'none';
  state.dom.pane.style.pointerEvents = state.dom.content.style.pointerEvents = 'auto';
  placeNavigation(context, node, state);
  return true;
}

export function navigationTemplateChildren(context, node, part) {
  if (part.properties.Name !== 'PanePresenter' || controlName(node) !== 'NavigationView') return undefined;
  const state = paneState(context, node);
  const values = state.entries.flatMap(entry => [entry.properties.Content, entry.properties.Icon, entry.properties.InfoBadge]);
  values.push(node.properties.PaneHeader, node.properties.PaneFooter, node.properties.AutoSuggestBox);
  return values.filter(value => value?.$ref && context.nodes.get(value.$ref)?.type).map(value => value.$ref);
}

function expand(context, node, state, entry, open) {
  if (!entry.node || !entry.children || !!entry.properties.IsExpanded === open) return false;
  entry.properties.IsExpanded = open;
  context.emit(node, open ? 'ItemExpanding' : 'ItemCollapsed', { ExpandingItem: entry.value, ExpandingItemContainer: entry.value });
  context.invalidate(node.id, 'measure');
  return true;
}

function select(context, node, state, entry) {
  if (!entry?.selectable || entry.properties.IsEnabled === false) return false;
  context.emit(node, 'ItemInvoked', { InvokedItem: entry.properties.Content ?? entry.value,
    InvokedItemContainer: entry.value, IsSettingsInvoked: !!entry.settings });
  if (entry.properties.SelectsOnInvoked === false) return true;
  const previous = node.properties.SelectedItem;
  node.properties.SelectedItem = entry.value;
  node.properties.SelectedIndex = entry.depth === 0 && entry.key.startsWith('menu:') ? entry.index : -1;
  const previousNode = previous?.$ref ? context.nodes.get(previous.$ref) : null;
  if (previousNode) previousNode.properties.IsSelected = false;
  if (entry.node) entry.node.properties.IsSelected = true;
  emitChange(context, node, 'SelectionChanged', { SelectedItem: entry.value, SelectedItemContainer: entry.value,
    PreviousItemContainer: previous, IsSettingsSelected: !!entry.settings, SelectedIndex: node.properties.SelectedIndex });
  if (state.geometry.overlay) requestPane(context, node, state, false, 'Selection');
  return true;
}

export function navigationEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const state = paneState(context, node);
  const part = event.target.closest?.('[data-part]')?.dataset.part;
  if (event.type === 'click' && part === 'navigation-back') { context.emit(node, 'BackRequested', {}); return true; }
  if (event.type === 'click' && part === 'navigation-toggle') return requestPane(context, node, state, !state.model.open, 'Toggle');
  if (event.type === 'click' && part === 'navigation-dismiss' || event.type === 'keydown' && event.key === 'Escape') {
    return state.geometry.overlay && requestPane(context, node, state, false, 'LightDismiss');
  }
  const key = event.target.closest?.('[data-navigation-key]')?.dataset.navigationKey;
  const entry = state.entries.find(value => value.key === key);
  if (!entry) return false;
  state.focusKey = key;
  if (event.type === 'click') return event.target.dataset.navigationExpand
    ? expand(context, node, state, entry, !entry.properties.IsExpanded) : select(context, node, state, entry);
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); return select(context, node, state, entry); }
  const rtl = node.properties.FlowDirection === 1;
  if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') && entry.children) {
    event.preventDefault();
    return expand(context, node, state, entry, true);
  }
  if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) {
    event.preventDefault();
    if (entry.properties.IsExpanded) return expand(context, node, state, entry, false);
    if (entry.parentKey) state.rows.get(entry.parentKey)?.focus();
    return true;
  }
  const available = state.entries.filter(value => value.selectable && value.properties.IsEnabled !== false);
  const index = available.indexOf(entry);
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
    : event.key === 'ArrowDown' ? Math.min(available.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : -1;
  if (target < 0) return false;
  event.preventDefault();
  state.focusKey = available[target].key;
  for (const value of available) state.rows.get(value.key).tabIndex = value.key === state.focusKey ? 0 : -1;
  state.rows.get(state.focusKey).focus();
  return true;
}

function requestPane(context, node, state, value, reason) {
  if (!controlEventRequester(context)) return state.model.setOpen(value, reason);
  state.model.requestOpen(value, (name, payload, options) => requestControlEvent(context, node, name, payload, options), reason)
    .catch(error => { if (error?.name !== 'AbortError') context.host.options.onError?.(error); });
  return true;
}

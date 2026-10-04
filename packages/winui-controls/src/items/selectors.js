import { sourceItems, itemAt } from './item-source.js';
import { registerFamily, controlName, createPart, stateFor, emitChange, ControlError } from '../policy/events.js';
import { SemanticZoomModel } from './grouping.js';
import { selectorRealization, selectorContent, selectorVisualChildren } from './selector-realization.js';

function setIndex(context, node, value, count) {
  const key = controlName(node) === 'PipsPager' ? 'SelectedPageIndex' : 'SelectedIndex';
  const index = count ? Math.max(0, Math.min(count - 1, value)) : -1;
  if (node.properties[key] === index) return;
  const previous = node.properties[key] ?? -1;
  node.properties[key] = index;
  const items = sourceItems(context, node);
  if (controlName(node) !== 'PipsPager') node.properties.SelectedItem = itemAt(items, index) ?? null;
  emitChange(context, node, controlName(node) === 'PipsPager' ? 'SelectedIndexChanged' : 'SelectionChanged',
    { OldIndex: previous, SelectedIndex: index, SelectedItem: itemAt(items, index),
      AddedItems: index < 0 ? [] : [itemAt(items, index)], RemovedItems: previous < 0 ? [] : [itemAt(items, previous)], value: index });
}

function renderSelector(context, node, element) {
  const kind = controlName(node);
  const properties = node.properties;
  const items = sourceItems(context, node);
  const count = kind === 'PipsPager' ? properties.NumberOfPages ?? 0 : items.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) throw new ControlError('SFUI1603', 'Invalid selector item count');
  const current = properties[kind === 'PipsPager' ? 'SelectedPageIndex' : 'SelectedIndex'] ?? 0;
  const selected = count ? Math.max(0, Math.min(count - 1, current)) : -1;
  if (kind === 'FlipView') {
    const [previous, body, next] = element.children;
    previous.hidden = selected <= 0;
    next.hidden = selected >= count - 1;
    selectorRealization(context, node, items, selected < 0 ? [] : [selected]);
    selectorContent(context, node, body, items, selected);
    body.setAttribute('aria-live', 'polite');
    body.setAttribute('aria-label', `Item ${selected + 1} of ${count}`);
    return;
  }
  element.setAttribute('role', kind === 'BreadcrumbBar' ? 'navigation' : kind === 'RadioButtons' ? 'radiogroup' : 'tablist');
  element.style.display = 'flex';
  element.style.flexWrap = kind === 'RadioButtons' ? 'wrap' : '';
  if (kind === 'RadioButtons') {
    element.style.display = 'grid';
    element.style.gridTemplateColumns = `repeat(${Math.max(1, Math.min(100, properties.MaxColumns ?? 1))}, minmax(0, 1fr))`;
  }
  if (kind !== 'PipsPager' && count > 2048) throw new ControlError('SFUI1603', kind + ' exceeds its 2048-item realization budget');
  const maximum = kind === 'BreadcrumbBar' ? Math.max(2, properties.MaxVisibleItems ?? 5)
    : kind === 'PipsPager' ? Math.max(1, properties.MaxVisiblePips ?? 5) : count;
  if (!Number.isInteger(maximum) || maximum > 2048) throw new ControlError('SFUI1603', 'Invalid visible selector item budget');
  const first = Math.max(0, Math.min(count - maximum, selected - Math.floor(maximum / 2)));
  const visible = kind === 'PipsPager' ? Array.from({ length: Math.min(maximum, count) }, (_, index) => first + index)
    : count > maximum ? [0, ...Array.from({ length: maximum - 1 }, (_, index) => count - maximum + 1 + index)]
    : Array.from({ length: count }, (_, index) => index);
  if (kind !== 'PipsPager') {
    selectorRealization(context, node, items, Array.from({ length: count }, (_, index) => index));
  }
  const children = [];
  for (const index of visible) {
    if (kind === 'BreadcrumbBar' && index > 1 && children.length === 1) {
      const details = createPart(context.document, 'details', 'breadcrumb-overflow');
      const summary = context.document.createElement('summary');
      summary.textContent = '…';
      summary.setAttribute('aria-label', 'Earlier locations');
      details.append(summary);
      for (let hidden = 1; hidden < index; hidden++) details.append(selectorButton(context, node, items, hidden, selected, kind));
      children.push(details);
    }
    children.push(selectorButton(context, node, items, index, selected, kind));
  }
  context.ordered(element, children);
  if (kind === 'PipsPager') {
    const buttons = stateFor(context, node, 'selector-buttons', () => ({ buttons: new Map() })).buttons;
    const active = new Set(visible);
    for (const index of buttons.keys()) if (!active.has(index)) buttons.delete(index);
  }
}

function selectorButton(context, node, items, index, selected, kind) {
  const state = stateFor(context, node, 'selector-buttons', () => ({ buttons: new Map(), dispose() { this.buttons.clear(); } }));
  if (!state.buttons.has(index)) state.buttons.set(index, createPart(context.document, 'button', 'selector-item'));
  const button = state.buttons.get(index);
  button.dataset.selectorIndex = String(index);
  if (kind === 'PipsPager') button.textContent = '●';
  else selectorContent(context, node, button, items, index);
  button.setAttribute('aria-label', kind === 'PipsPager' ? `Page ${index + 1}` : button.textContent);
  const role = kind === 'RadioButtons' ? 'radio' : kind === 'BreadcrumbBar' ? 'link' : 'tab';
  button.setAttribute('role', role);
  if (role !== 'link') button.setAttribute(role === 'radio' ? 'aria-checked' : 'aria-selected', String(index === selected));
  if (kind === 'BreadcrumbBar' && index === items.length - 1) button.setAttribute('aria-current', 'page');
  button.tabIndex = index === (selected < 0 ? 0 : selected) || kind === 'BreadcrumbBar' ? 0 : -1;
  return button;
}

function selectorEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const kind = controlName(node);
  const count = kind === 'PipsPager' ? node.properties.NumberOfPages ?? 0 : sourceItems(context, node).length;
  const current = node.properties[kind === 'PipsPager' ? 'SelectedPageIndex' : 'SelectedIndex'] ?? 0;
  const target = event.target.closest?.('[data-selector-index]');
  if (event.type === 'click' && target) {
    const index = Number(target.dataset.selectorIndex);
    setIndex(context, node, index, count);
    if (kind === 'BreadcrumbBar') context.emit(node, 'ItemClicked', { Index: index, Item: itemAt(sourceItems(context, node), index) });
    return true;
  }
  const action = event.target.closest?.('[data-part]')?.dataset.part;
  if (event.type === 'click' && ['flip-previous', 'flip-next'].includes(action)) {
    setIndex(context, node, current + (action === 'flip-next' ? 1 : -1), count);
    return true;
  }
  if (event.type === 'keydown' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * (node.properties.FlowDirection === 1 ? -1 : 1);
    setIndex(context, node, event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : current + delta, count);
    renderSelector(context, node, element);
    const selected = node.properties[kind === 'PipsPager' ? 'SelectedPageIndex' : 'SelectedIndex'];
    element.querySelector(`[data-selector-index="${selected}"]`)?.focus();
    return true;
  }
  const state = stateFor(context, node, 'swipe', () => ({ start: null }));
  if (event.type === 'pointerdown') state.start = { x: event.clientX, y: event.clientY };
  if (event.type === 'pointerup' && state.start) {
    const dx = event.clientX - state.start.x;
    const dy = event.clientY - state.start.y;
    state.start = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) setIndex(context, node, current + (dx < 0 ? 1 : -1), count);
  }
  return false;
}

export function registerSelectorRenderers(registry) {
  registerFamily(registry, ['FlipView', 'PipsPager', 'SelectorBar', 'RadioButtons', 'BreadcrumbBar'], {
    virtualizesItems: true,
    getVisualChildren: selectorVisualChildren,
    create(context, node) {
      const root = context.document.createElement('div');
      if (controlName(node) === 'FlipView') {
        const previous = createPart(context.document, 'button', 'flip-previous');
        const next = createPart(context.document, 'button', 'flip-next');
        previous.textContent = '‹';
        next.textContent = '›';
        previous.setAttribute('aria-label', 'Previous item');
        next.setAttribute('aria-label', 'Next item');
        root.append(previous, createPart(context.document, 'div', 'flip-content'), next);
      }
      return root;
    }, render: renderSelector, invoke(context, node, element, method, args) {
      if (method !== 'Select') return undefined;
      if (node.properties.IsEnabled === false) return false;
      const count = controlName(node) === 'PipsPager' ? node.properties.NumberOfPages ?? 0 : sourceItems(context, node).length;
      const index = Number(args[0]);
      if (!Number.isInteger(index) || index < 0 || index >= count) return false;
      setIndex(context, node, index, count);
      return true;
    }, events: { click: selectorEvent, keydown: selectorEvent,
      pointerdown: selectorEvent, pointerup: selectorEvent }
  });
  registerFamily(registry, 'SemanticZoom', {
    create: context => context.document.createElement('div'),
    render(context, node, element) {
      const model = semanticState(context, node);
      model.canChange = node.properties.CanChangeViews !== false;
      model.active = node.properties.IsZoomedInViewActive !== false;
      context.content(element, node.properties.IsZoomedInViewActive === false ? node.properties.ZoomedOutView : node.properties.ZoomedInView);
    }, invoke(context, node, element, method) {
      if (method !== 'ToggleActiveView') return undefined;
      return semanticState(context, node).toggle();
    }, events: { keydown(context, node, element, event) {
      if (!(event.ctrlKey && (event.key === '+' || event.key === '-'))) return false;
      event.preventDefault();
      return semanticState(context, node).toggle(event.key === '+');
    } }
  });
}

function semanticState(context, node) {
  return stateFor(context, node, 'semantic-zoom', () => {
    const view = active => context.nodes.get(node.properties[active ? 'ZoomedInView' : 'ZoomedOutView']?.$ref);
    const model = new SemanticZoomModel({ active: node.properties.IsZoomedInViewActive !== false,
      canChange: node.properties.CanChangeViews !== false,
      capture(active) {
        const source = view(active);
        return source ? context.host.invoke(source.id, 'GetGroupAnchor', []) ?? source.properties.GroupAnchor
          ?? source.properties.SelectedItem : null;
      }, restore(active, anchor) {
        const target = view(active);
        if (!target) return;
        target.properties.GroupAnchor = anchor;
        context.host.invoke(target.id, 'RestoreGroupAnchor', [anchor]);
      } });
    model.on('ViewChangeStarted', args => context.emit(node, 'ViewChangeStarted', args));
    model.on('ViewChangeCompleted', args => {
      node.properties.IsZoomedInViewActive = model.active;
      node.properties.GroupAnchor = model.anchor;
      emitChange(context, node, 'ViewChangeCompleted', args);
    });
    return model;
  });
}

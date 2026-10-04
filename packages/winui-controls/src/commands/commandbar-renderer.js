import { createPart, registerFamily, stateFor, controlName } from '../policy/events.js';
import { commandBarGeometry } from './geometry.js';
import { commandTemplateChildren, referenceId } from './layout-parts.js';
import { menuEvent } from './menu-events.js';
import { showControlOverlay, hideControlOverlay } from '../overlay/index.js';

function commandBarState(context, node) {
  return stateFor(context, node, 'commandbar', () => ({ open: !!node.properties.IsOpen, overflow: new Set() }));
}

function setCommandBarOpen(context, node, value) {
  const state = commandBarState(context, node), next = !!value;
  if (state.open === next) return;
  if (controlName(node) === 'CommandBar') context.emit(node, next ? 'Opening' : 'Closing', { IsOpen: next });
  state.open = next; node.properties.IsOpen = next;
  if (controlName(node) === 'CommandBar') context.emit(node, next ? 'Opened' : 'Closed', { IsOpen: next });
  context.invalidate(node.id);
}

function fallbackGeometry(context, node, element) {
  const values = node.collections.PrimaryCommands?.length ? node.collections.PrimaryCommands : node.collections.Children ?? [];
  const primary = values.map(referenceId).filter(Boolean);
  const secondary = (node.collections.SecondaryCommands ?? []).map(referenceId).filter(Boolean);
  const content = element.firstElementChild;
  return commandBarGeometry({ primary, secondary, properties: node.properties,
    available: { width: element.clientWidth || node.properties.Width || 320, height: element.clientHeight || 48 },
    content: { width: content.scrollWidth || 0, height: content.scrollHeight || 0 } }, id => {
    const target = context.host.ensure(id), properties = context.nodes.get(id)?.properties ?? {};
    return { width: properties.Width || target?.offsetWidth || 48, height: properties.Height || target?.offsetHeight || 32 };
  }, id => context.nodes.get(id)?.properties.DynamicOverflowOrder ?? 0);
}

function applyCommandPresentation(context, node, id, slot) {
  const item = context.nodes.get(id), element = context.elements.get(id);
  if (!item || !element) return;
  element.hidden = slot.hidden;
  item.properties.IsInOverflow = slot.overflow;
  const native = context.getState(item).familyTemplate?.root ?? element;
  const toggle = controlName(item) === 'AppBarToggleButton';
  native.setAttribute('role', slot.overflow ? toggle ? 'menuitemcheckbox' : 'menuitem' : 'button');
  if (slot.overflow && toggle) native.setAttribute('aria-checked', String(!!item.properties.IsChecked));
  else native.removeAttribute('aria-checked');
  const label = native.querySelector('[data-part="appbar-label"]');
  const position = node.properties.DefaultLabelPosition ?? 0;
  if (label) label.hidden = !slot.overflow && (item.properties.LabelPosition === 1 || position === 2 || position === 'Collapsed'
    || !node.properties.IsOpen && (position === 0 || position === 'Bottom'));
  native.style.flexDirection = slot.overflow || position === 1 || position === 'Right' ? 'row' : 'column';
  native.tabIndex = slot.hidden ? -1 : 0;
}

function renderCommandLayout(context, node, element, geometry) {
  const [content, primary, overflow] = element.children, menu = overflow.lastElementChild;
  const state = commandBarState(context, node), next = new Set(geometry.overflow);
  if (controlName(node) === 'CommandBar') {
    for (const [action, ids] of [[0, [...next].filter(id => !state.overflow.has(id))],
      [1, [...state.overflow].filter(id => !next.has(id))]]) {
      if (ids.length) context.emit(node, 'DynamicOverflowItemsChanging', { Action: action, Items: ids.map(id => ({ $ref: id })) });
    }
  }
  state.overflow = next;
  context.ordered(primary, geometry.primary.map(id => context.host.ensure(id)).filter(Boolean));
  context.ordered(menu, [...geometry.overflow, ...geometry.secondary].map(id => context.host.ensure(id)).filter(Boolean));
  overflow.hidden = geometry.button.width === 0 || geometry.hidden;
  overflow.open = !!node.properties.IsOpen || !!node.properties.AlwaysExpanded;
  Object.assign(overflow.firstElementChild.style, { position: 'absolute', left: geometry.button.x + 'px', top: '0',
    width: geometry.button.width + 'px', height: geometry.button.height + 'px', display: 'grid', placeItems: 'center', listStyle: 'none' });
  if (!node.properties.Content?.$ref) Object.assign(content.style, { position: 'absolute', left: '0', top: '0',
    width: geometry.content.width + 'px', height: geometry.content.height + 'px' });
  for (const [id, slot] of geometry.rectangles) {
    applyCommandPresentation(context, node, id, slot);
    if (!context.host.layoutEngine) {
      const target = context.elements.get(id);
      if (target) Object.assign(target.style, { position: 'absolute', left: slot.x + 'px', top: slot.y + 'px',
        width: slot.width + 'px', height: slot.height + 'px' });
    }
  }
}

export function registerCommandBarRenderers(registry) {
  registerFamily(registry, ['CommandBar', 'CommandBarFlyout'], {
    create(context, node) {
      const element = context.document.createElement('div'), overflow = context.document.createElement('details');
      const summary = context.document.createElement('summary');
      summary.textContent = '…'; summary.setAttribute('aria-label', 'More commands'); summary.setAttribute('aria-haspopup', 'menu');
      const menu = createPart(context.document, 'div', 'command-overflow');
      menu.setAttribute('role', 'menu'); overflow.append(summary, menu);
      element.append(createPart(context.document, 'div', 'command-content'), createPart(context.document, 'div', 'command-primary'), overflow);
      for (const child of [element, ...element.children, menu]) child.style.position = 'static';
      const dismiss = event => { if (node.properties.IsOpen && !element.contains(event.target)) setCommandBarOpen(context, node, false); };
      context.root.addEventListener('pointerdown', dismiss, true);
      const state = commandBarState(context, node);
      state.dispose = () => context.root.removeEventListener('pointerdown', dismiss, true);
      return element;
    },
    render(context, node, element) {
      context.content(element.firstElementChild, node.properties.Content);
      setCommandBarOpen(context, node, node.properties.IsOpen);
      element.setAttribute('role', 'toolbar');
      const geometry = context.host.layoutEngine?.states.get(node.id)?.data.commandLayout ?? fallbackGeometry(context, node, element);
      renderCommandLayout(context, node, element, geometry);
    },
    afterLayout(context, node, element) {
      const geometry = context.host.layoutEngine?.states.get(node.id)?.data.commandLayout;
      if (geometry) renderCommandLayout(context, node, context.getState(node).familyTemplate?.root ?? element, geometry);
    }, getTemplatePartChildren: commandTemplateChildren, bubbleEvents: ['keydown', 'click'],
    invoke(context, node, element, method, args = []) {
      if (method === 'ShowAt') return showControlOverlay(context, node,
        { target: args[0]?.$ref ? context.host.ensure(args[0].$ref) : args[0] });
      if (method === 'Hide') return hideControlOverlay(context, node);
      if (method === 'Expand' || method === 'Collapse') { setCommandBarOpen(context, node, method === 'Expand'); return true; }
      return undefined;
    }, events: {
      keydown(context, node, element, event) {
        if (event.key === 'Escape' && node.properties.IsOpen) {
          event.preventDefault(); setCommandBarOpen(context, node, false); element.lastElementChild.firstElementChild.focus(); return true;
        }
        return menuEvent(context, node, element, event);
      },
      click(context, node, element, event) {
        if (event.target.closest('summary') === element.lastElementChild.firstElementChild) {
          event.preventDefault(); setCommandBarOpen(context, node, !node.properties.IsOpen); return true;
        }
        if (event.target.closest('[role="menuitem"],[role="menuitemcheckbox"]')) setCommandBarOpen(context, node, false);
        return false;
      }
    }
  });
}

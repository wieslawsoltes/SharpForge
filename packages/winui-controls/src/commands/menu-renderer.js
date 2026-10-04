import { createPart, registerFamily, controlName, stateFor } from '../policy/events.js';
import { commandCanExecute } from './command.js';
import { showControlOverlay, hideControlOverlay } from '../overlay/index.js';
import { renderIconSource } from '../icons/index.js';
import { menuEvent, setMenuOpen, enabledMenuItems } from './menu-events.js';
import { menuTemplateChildren } from './layout-parts.js';
import { registerCommandBarRenderers } from './commandbar-renderer.js';

function renderMenu(context, node, element) {
  const kind = controlName(node), properties = node.properties;
  if (['MenuFlyoutSeparator', 'AppBarSeparator'].includes(kind)) {
    element.setAttribute('role', 'separator');
    element.style.borderTop = '1px solid currentColor'; element.style.opacity = '0.4';
    return;
  }
  if (['MenuFlyoutItem', 'ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem'].includes(kind)) {
    element.setAttribute('role', kind === 'ToggleMenuFlyoutItem' ? 'menuitemcheckbox' : kind === 'RadioMenuFlyoutItem' ? 'menuitemradio' : 'menuitem');
    if (kind !== 'MenuFlyoutItem') element.setAttribute('aria-checked', String(!!properties.IsChecked));
    element.disabled = properties.IsEnabled === false || !commandCanExecute(context, node);
    const [icon, text, accelerator] = element.children;
    icon.hidden = !properties.Icon;
    if (properties.Icon) renderIconSource(context, properties.Icon, icon);
    text.textContent = String(properties.Text ?? properties.Label ?? '');
    accelerator.textContent = String(properties.KeyboardAcceleratorTextOverride ?? '');
    Object.assign(element.style, { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'start' });
    accelerator.style.marginInlineStart = 'auto';
    return;
  }
  if (['MenuBarItem', 'MenuFlyoutSubItem'].includes(kind)) {
    const [summary, menu] = element.children;
    summary.textContent = String(properties.Title || properties.Text || '');
    summary.setAttribute('role', 'menuitem');
    summary.setAttribute('aria-haspopup', 'menu');
    summary.setAttribute('aria-expanded', String(element.open));
    summary.setAttribute('aria-disabled', String(properties.IsEnabled === false));
    summary.tabIndex = properties.IsEnabled === false ? -1 : 0;
    Object.assign(summary.style, { display: 'flex', alignItems: 'center', height: '100%', listStyle: 'none', cursor: 'default' });
    menu.setAttribute('role', 'menu');
    menu.style.position = 'static';
    context.ordered(menu, context.children(node, 'Items'));
  } else {
    element.setAttribute('role', kind === 'MenuBar' ? 'menubar' : 'menu');
    context.ordered(element, context.children(node, 'Items'));
    const items = enabledMenuItems(element);
    if (!items.some(item => item.tabIndex === 0)) items[0]?.setAttribute('tabindex', '0');
  }
}

function afterMenuLayout(context, node, element) {
  const state = context.host.layoutEngine?.states.get(node.id), model = state?.data.menuLayout;
  if (!model) return;
  for (const [id, slot] of model.rectangles) {
    const child = context.elements.get(id);
    if (child) child.hidden = slot.hidden;
  }
  const native = context.getState(node).familyTemplate?.root ?? element;
  if (native.dataset.menuOwner) {
    const open = stateFor(context, node, 'menu-open', () => ({ open: native.open })).open;
    if (state.data.menuOpen !== open) { state.data.menuOpen = open; context.invalidate(node.id); }
    native.open = open;
  }
}

export function registerCommandRenderers(registry) {
  registerFamily(registry, ['MenuFlyout', 'MenuFlyoutItem', 'MenuFlyoutSubItem', 'MenuFlyoutSeparator',
    'ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem', 'MenuBar', 'MenuBarItem', 'AppBarSeparator'], {
    create(context, node) {
      const kind = controlName(node), submenu = ['MenuBarItem', 'MenuFlyoutSubItem'].includes(kind);
      const item = ['MenuFlyoutItem', 'ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem'].includes(kind);
      const element = context.document.createElement(submenu ? 'details' : item ? 'button' : 'div');
      if (item) {
        element.type = 'button'; element.tabIndex = -1; element.dataset.menuItemOwner = node.id;
        element.append(createPart(context.document, 'span', 'menu-icon'), createPart(context.document, 'span', 'menu-text'),
          createPart(context.document, 'span', 'menu-accelerator'));
      } else if (submenu) {
        element.dataset.menuOwner = node.id;
        element.append(context.document.createElement('summary'), context.document.createElement('div'));
      }
      if (kind === 'MenuBar' && context.services.interactions) {
        stateFor(context, node, 'menubar-activation', () => {
          const remove = context.services.interactions.router(context).registerMenuBar(element, () => enabledMenuItems(element)[0]?.focus());
          return { dispose: remove };
        });
      }
      return element;
    }, render: renderMenu, afterLayout: afterMenuLayout, getTemplatePartChildren: menuTemplateChildren,
    bubbleEvents: ['keydown'],
    invoke(context, node, element, method, args = []) {
      if (method === 'ShowAt') return showControlOverlay(context, node,
        { target: args[0]?.$ref ? context.host.ensure(args[0].$ref) : args[0], point: args[1] });
      if (method === 'Hide') return hideControlOverlay(context, node);
      if (method === 'Expand' || method === 'Collapse') { setMenuOpen(context, element, method === 'Expand'); return true; }
      if (method === 'Invoke' || method === 'Toggle') {
        renderMenu(context, node, element);
        if (element.disabled) return false;
        element.click(); return true;
      }
      return undefined;
    }, events: { click: menuEvent, keydown: menuEvent, pointerover: menuEvent }
  });
  registerCommandBarRenderers(registry);
  registerFamily(registry, 'AppBarElementContainer', { create: context => context.document.createElement('div'),
    render(context, node, element) { context.content(element, node.properties.Content); } });
}

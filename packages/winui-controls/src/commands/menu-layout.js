import { size, rect, insets, innerSize, addInsets, typeName } from '../layout/geometry.js';
import { behaviorPart, commandIds, commandDesired, arrangeCommand } from './layout-parts.js';

function menuItems(context, available) {
  return commandIds(context, 'Items').map(id => ({ id, desired: commandDesired(context, id, size(available.width, Infinity)) }));
}

export const menuLayout = {
  measure(context, available) {
    const inset = insets(context.node.templateRoot ? { ...context.properties, BorderThickness: 0 } : context.properties);
    const inner = innerSize(available, inset), kind = typeName(context.node);
    const items = menuItems(context, inner), horizontal = kind === 'MenuBar';
    const submenu = kind === 'MenuFlyoutSubItem' || kind === 'MenuBarItem';
    const header = context.intrinsicOf({ ...context.node, properties: { ...context.properties,
      Text: context.properties.Title || context.properties.Text || '' } }, inner);
    const width = horizontal ? items.reduce((sum, item) => sum + item.desired.width, 0)
      : Math.max(0, ...items.map(item => item.desired.width));
    const height = horizontal ? Math.max(32, ...items.map(item => item.desired.height))
      : items.reduce((sum, item) => sum + item.desired.height, 0);
    for (const child of context.children) context.measure(child, inner);
    context.data.menuItems = items;
    context.data.menuBehaviorPart = behaviorPart(context);
    context.data.menuHeader = size(Math.max(40, header.width + 24), Math.max(32, header.height));
    return addInsets(submenu ? context.data.menuHeader : size(width, height), inset);
  },
  arrange(context, finalSize) {
    const inset = insets(context.node.templateRoot ? { ...context.properties, BorderThickness: 0 } : context.properties);
    const inner = innerSize(finalSize, inset), kind = typeName(context.node);
    const submenu = kind === 'MenuFlyoutSubItem' || kind === 'MenuBarItem';
    const horizontal = kind === 'MenuBar', items = context.data.menuItems ?? menuItems(context, inner);
    for (const child of context.children) context.arrange(child, rect(inset.left, inset.top, inner.width, inner.height));
    const part = context.data.menuBehaviorPart;
    if (part) context.arrange(part, rect(0, 0, inner.width, inner.height));
    let x = kind === 'MenuFlyoutSubItem' ? inner.width : 0;
    let y = kind === 'MenuBarItem' ? inner.height : 0;
    const menuWidth = submenu ? Math.max(160, ...items.map(item => item.desired.width)) : inner.width;
    const rectangles = new Map();
    for (const item of items) {
      const slot = { x, y, width: horizontal ? item.desired.width : menuWidth,
        height: horizontal ? inner.height : item.desired.height, hidden: submenu && !context.data.menuOpen };
      rectangles.set(item.id, slot);
      arrangeCommand(context, item.id, slot);
      if (horizontal) x += item.desired.width;
      else y += item.desired.height;
    }
    context.data.menuLayout = { rectangles, horizontal, submenu };
  }
};

export function registerMenuLayouts(registry) {
  registry.register(['MenuFlyout', 'MenuFlyoutSubItem', 'MenuBar', 'MenuBarItem'], menuLayout);
  return registry;
}

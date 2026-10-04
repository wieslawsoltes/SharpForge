import { registerFamily } from '../policy/events.js';
import { renderTabs, tabEvent, tabDrag, selectTab } from './tabs.js';
import { createNavigation, renderNavigation, navigationEvent, navigationAfterLayout,
  mountNavigationTemplate, navigationTemplateChildren } from './pane-renderer.js';

export { NavigationFrame } from './frame.js';
export * from './pane.js';
export * from './menu-model.js';
export * from './layout.js';

export function registerNavigationRenderers(registry) {
  registerFamily(registry, ['TabView', 'Pivot'], { create(context) {
    const element = context.document.createElement('div');
    const header = context.document.createElement('div');
    const content = context.document.createElement('div');
    header.dataset.part = 'tab-headers';
    content.dataset.part = 'tab-content';
    element.append(header, content);
    return element;
  }, render: renderTabs,
  invoke(context, node, element, method, args) {
    if (method === 'Select') return selectTab(context, node, Number(args[0]));
    return undefined;
  }, events: { click: tabEvent, keydown: tabEvent, auxclick: tabEvent,
    dragstart: tabDrag, dragover: tabDrag, drop: tabDrag, dragend: tabDrag } });
  registerFamily(registry, ['NavigationView', 'SplitView'], {
    create: createNavigation, render: renderNavigation, afterLayout: navigationAfterLayout,
    mountTemplate: mountNavigationTemplate, getTemplatePartChildren: navigationTemplateChildren,
    bubbleEvents: ['click', 'keydown'], events: { click: navigationEvent, keydown: navigationEvent }
  });
  registerFamily(registry, ['Frame', 'Page', 'TabViewItem', 'PivotItem', 'NavigationViewItem'], {
    create: context => context.document.createElement('div'),
    render(context, node, element) { context.content(element, node.properties.Content); }
  });
}

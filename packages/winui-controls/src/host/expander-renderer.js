import { makeElement } from './dom-properties.js';
import { registerFamily } from '../policy/events.js';

function stateFor(context, node) { return context.getState(node); }
function ownerNode(context, node) { return context.nodes.get(node.id) ?? node; }

function create(context, node) {
  const root = makeElement(context);
  const header = makeElement(context, 'button', { type: 'button', 'data-expander-header': '' });
  const content = makeElement(context, 'div', { 'data-expander-content': '' });
  content.id = context.host.rootKey + ':' + node.id + ':expander-content';
  header.setAttribute('aria-controls', content.id);
  Object.assign(header.style, { position: 'absolute', boxSizing: 'border-box', margin: '0', textAlign: 'start', font: 'inherit' });
  Object.assign(content.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
  root.append(header, content);
  stateFor(context, node).expanderParts = { header, content, animation: null, expanded: undefined };
  return root;
}
function render(context, node, element) {
  const owner = ownerNode(context, node), parts = stateFor(context, node).expanderParts;
  if (owner.templateRoot) parts.header.remove();
  else {
    if (parts.header.parentNode !== element) element.prepend(parts.header);
    context.content(parts.header, node.properties.Header);
  }
  context.content(parts.content, node.properties.Content);
  parts.content.hidden = !node.properties.IsExpanded;
  parts.header.setAttribute('aria-expanded', String(!!node.properties.IsExpanded));
  parts.header.disabled = node.properties.IsEnabled === false;
  element.style.padding = '0px';
}
function afterRender(context, node) {
  const state = stateFor(context, node), template = state.familyTemplate, parts = state.expanderParts;
  const headerId = template?.parts.get('HeaderPresenter');
  if (!headerId) return;
  const presenter = context.host.ensure(headerId);
  const children = [...presenter.childNodes].filter(child => child !== parts.header);
  if (children.length) context.ordered(parts.header, children);
  else if (!parts.header.childNodes.length) context.content(parts.header, node.properties.Header);
  context.ordered(presenter, [parts.header]);
  Object.assign(parts.header.style, { inset: '0', width: '100%', height: '100%', border: '0', padding: '0' });
}
function afterLayout(context, node) {
  const state = stateFor(context, node), parts = state.expanderParts;
  const layout = context.host.layoutEngine.states.get(node.id)?.data;
  if (!layout) return;
  if (!node.templateRoot) {
    const header = layout.headerRect;
    Object.assign(parts.header.style, { left: header.x + 'px', top: header.y + 'px', width: header.width + 'px', height: header.height + 'px' });
    const child = context.elements.get(node.properties.Header?.$ref);
    if (child) child.style.transform = `translate(${-header.x}px, ${-header.y}px) ` + child.style.transform;
  }
  const expanded = !!node.properties.IsExpanded;
  if (parts.expanded !== expanded) {
    const previous = parts.expanded;
    parts.expanded = expanded;
    parts.animation?.cancel();
    parts.animation = null;
    if (previous !== undefined && expanded && context.services.environment?.AnimationsEnabled !== false && parts.content.animate) {
      const up = node.properties.ExpandDirection === 1 || node.properties.ExpandDirection === 'Up';
      parts.animation = parts.content.animate([{ clipPath: `inset(${up ? '100% 0 0' : '0 0 100%'})`, opacity: 0 },
        { clipPath: 'inset(0)', opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }
  }
}
function setExpanded(context, node, expanded) {
  const owner = ownerNode(context, node);
  if (!!owner.properties.IsExpanded === expanded || owner.properties.IsEnabled === false) return false;
  owner.properties.IsExpanded = expanded;
  context.emit(owner, expanded ? 'Expanding' : 'Collapsed', { value: expanded });
  context.invalidate(owner.id);
  return true;
}

export function registerExpanderRenderer(registry) {
  registerFamily(registry, 'Expander', { create, render, afterRender, afterLayout, bubbleEvents: ['click'],
    events: { click(context, node, element, event) {
      if (stateFor(context, node).expanderParts.header.contains(event.target)) setExpanded(context, node, !node.properties.IsExpanded);
    } }, invoke(context, node, element, method) {
      if (method === 'Expand' || method === 'Collapse') return setExpanded(context, node, method === 'Expand');
      throw new Error('Unsupported Expander operation: ' + method);
    }, automationElement: (context, node) => stateFor(context, node).expanderParts.header,
    dispose(context, node) { stateFor(context, node).expanderParts.animation?.cancel(); } });
}

import { contentLayout } from './border-viewbox.js';
import { scrollViewerLayout } from './scrollviewer.js';

/** Resolve an actual template node; no synthetic identity stands in for ScrollView.ScrollPresenter. */
export function findScrollPresenter(node, resolve) {
  if (!node?.templateRoot || node.type.split('.').at(-1) !== 'ScrollView') return null;
  const pending = [node.templateRoot], visited = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    if (visited.size >= 1000) throw new RangeError('SFUI1649: ScrollView template node budget exceeded');
    visited.add(id);
    const child = resolve(id);
    if (!child) continue;
    if (child.properties.Name === 'PART_ScrollPresenter' && child.type.split('.').at(-1) === 'ScrollPresenter') return id;
    for (const property of ['Content', 'Child']) if (child.properties[property]?.$ref) pending.push(child.properties[property].$ref);
    for (const value of child.collections?.Children ?? []) if (value?.$ref) pending.push(value.$ref);
  }
  return null;
}

export function scrollOwner(host, node) {
  const owner = host.nodes.get(node.templateOwner);
  return findScrollPresenter(owner, id => host.nodes.get(id)) === node.id ? owner : null;
}

/** A templated outer ScrollView delegates scrolling to its real presenter without applying the transform twice. */
export const scrollViewLayout = {
  measure(context, available) {
    const presenter = findScrollPresenter(context.node, context.resolve);
    context.data.scrollPresenter = presenter;
    return presenter ? contentLayout.measure(context, available) : scrollViewerLayout.measure(context, available);
  },
  arrange(context, finalSize) {
    if (!context.data.scrollPresenter) return scrollViewerLayout.arrange(context, finalSize);
    contentLayout.arrange(context, finalSize);
    context.data.scroll = context.state(context.data.scrollPresenter)?.data.scroll;
    context.data.currentAnchor = context.state(context.data.scrollPresenter)?.data.currentAnchor;
    context.data.childTransform = undefined;
  }
};

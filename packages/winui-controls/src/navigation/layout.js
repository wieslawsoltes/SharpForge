import { size, rect, insets, innerSize, addInsets, typeName } from '../layout/geometry.js';
import { navigationGeometry } from './pane.js';

function templateParts(context) {
  const pending = [...context.children];
  const parts = new Map();
  const seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    if (seen.size >= 1000) throw Object.assign(new Error('Navigation template exceeds its node budget'), { code: 'SFUI1649' });
    seen.add(id);
    const state = context.state(id);
    if (!state) continue;
    if (state.node.properties.Name) parts.set(state.node.properties.Name, id);
    pending.push(...state.children);
  }
  return parts;
}

function slots(context) {
  const parts = templateParts(context);
  if (parts.has('NavigationContentPresenter')) return { parts,
    pane: parts.get('PanePresenter'), content: parts.get('NavigationContentPresenter') };
  const id = value => value?.$ref ?? value?.id ?? null;
  return { parts, pane: id(context.properties.Pane), content: id(context.properties.Content) };
}

function finiteAvailable(available, desired = size()) {
  return size(Number.isFinite(available.width) ? available.width : Math.max(320, desired.width),
    Number.isFinite(available.height) ? available.height : desired.height);
}

/** Measures pane and content separately; overlays do not shrink the content slot. */
export const navigationLayout = {
  measure(context, available) {
    const inset = insets(context.properties);
    const inner = innerSize(available, inset);
    const kind = typeName(context.node);
    const targets = slots(context);
    let desired = context.intrinsic(inner);
    for (const child of context.children) {
      const value = context.measure(child, inner);
      desired = size(Math.max(desired.width, value.width), Math.max(desired.height, value.height));
    }
    const geometry = navigationGeometry(kind, context.properties, finiteAvailable(inner, desired));
    if (targets.pane) context.measure(targets.pane, size(geometry.pane.width, inner.height));
    if (targets.content) {
      const content = context.measure(targets.content, size(geometry.content.width, inner.height));
      const reserved = geometry.chrome.width - geometry.content.width;
      desired = size(Math.max(desired.width, content.width + reserved), Math.max(desired.height, content.height + geometry.content.y));
    }
    context.data.navigationTargets = targets;
    return addInsets(desired, inset);
  },
  arrange(context, finalSize) {
    const inset = insets(context.properties);
    const inner = innerSize(finalSize, inset);
    const geometry = navigationGeometry(typeName(context.node), context.properties, inner);
    const targets = context.data.navigationTargets ?? slots(context);
    context.data.navigationGeometry = geometry;
    for (const child of context.children) context.arrange(child, rect(inset.left, inset.top, inner.width, inner.height));
    for (const [id, area] of [[targets.pane, geometry.pane], [targets.content, geometry.content]]) {
      if (id) context.arrange(id, rect(area.x, area.y, area.width, area.height));
    }
    const chrome = targets.parts.get('PART_BehaviorRoot');
    if (chrome) context.arrange(chrome, rect(0, 0, inner.width, inner.height));
  }
};

/** Registers the two navigation container contributions with the shared layout registry. */
export function registerNavigationLayouts(registry) {
  registry.register(['NavigationView', 'SplitView'], navigationLayout);
  return registry;
}

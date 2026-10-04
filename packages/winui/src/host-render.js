const suffix = type => type.slice(type.lastIndexOf('.') + 1);

/** Report exactly the same CSS-pixel size changes for full scenes and retained geometry updates. */
export function measureHostNodes(host, ids) {
  const changes = [];
  for (const id of ids) {
    const element = host.elements.get(id);
    if (!element) continue;
    const box = element.getBoundingClientRect();
    const size = [Math.round(box.width * 100) / 100, Math.round(box.height * 100) / 100];
    const previous = host.layouts.get(id);
    if (previous && previous[0] === size[0] && previous[1] === size[1]) continue;
    host.layouts.set(id, size);
    changes.push({id, width: size[0], height: size[1]});
  }
  if (changes.length) host.options.onLayout(changes);
}

/** Full scene fallback preserves drawing, flow layout, flyouts and retained element identities. */
export function renderHostScene(host) {
  const visible = host.reachable();
  for (const id of visible) host.ensure(id);
  for (const id of visible) host.renderNode(host.nodes.get(id), host.elements.get(id));
  for (const id of visible) {
    const node = host.nodes.get(id);
    if (['WrapGrid', 'VariableSizedWrapGrid', 'ItemsWrapGrid'].includes(suffix(node.type))) {
      host.renderWrapPanel(node, host.elements.get(id));
    }
  }
  const roots = [...host.windows, ...host.openFlyouts.keys()].map(id => host.ensure(id)).filter(Boolean);
  host.ordered(host.root, roots);
  for (const [id, element] of host.elements) {
    if (visible.has(id)) continue;
    host.resizeObserver?.unobserve(element);
    element.remove();
    host.elements.delete(id);
    host.surfaces.get(id)?.dispose();
    host.surfaces.delete(id);
    host.layouts.delete(id);
  }
  for (const id of visible) host.drawNode(host.nodes.get(id));
  measureHostNodes(host, visible);
  for (const command of host.pendingFlyouts.splice(0)) host.flyout(command);
}

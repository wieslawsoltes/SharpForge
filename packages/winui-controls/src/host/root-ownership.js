/** Open portal content stays retained while its managed owner is detached from a Window. */
export function overlayRoots(host) {
  return [...new Set([...host.openFlyouts.keys(), ...(host.services.overlays?.entries ?? []).map(entry => entry.id)])]
    .filter(id => typeof id === 'string' && host.nodes.has(id));
}

export function reachableNodes(host) {
  const result = new Set();
  const queue = [...host.windows, ...overlayRoots(host)];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (result.has(id)) continue;
    const node = host.nodes.get(id);
    if (!node) continue;
    result.add(id);
    if (result.size > 20000) throw new RangeError('SFUI1603: Retained visual node limit');
    queue.push(...host.visualChildren(node));
  }
  return result;
}

/** Portal wrappers own placement; their retained children still use the shared Measure/Arrange engine. */
export function updateHostLayout(host) {
  const engine = host.layoutEngine;
  const viewport = { width: host.root.clientWidth, height: host.root.clientHeight };
  engine.roots = host.windows.filter(id => engine.states.has(id));
  engine.updateLayout(viewport);
  host.portalTransforms = new Map();
  for (const id of overlayRoots(host)) {
    const state = engine.states.get(id);
    if (!state || state.parent || engine.roots.includes(id)) continue;
    const desired = engine.measure(id, viewport);
    const width = Math.min(viewport.width, desired.width), height = Math.min(viewport.height, desired.height);
    const entry = host.services.overlays?.entries.find(value => value.id === id);
    const x = entry?.modal ? Math.max(0, (viewport.width - width) / 2) : 0;
    const y = entry?.modal ? Math.max(0, (viewport.height - height) / 2) : 0;
    engine.arrange(id, { x, y, width, height });
    engine.roots.push(id);
    if (entry && !entry.modal) {
      const element = host.elements.get(id);
      if (element) { element.style.width = width + 'px'; element.style.height = height + 'px'; }
      host.services.overlays.position(entry);
      const rootBounds = host.root.getBoundingClientRect(), bounds = entry.wrapper.getBoundingClientRect();
      const sx = rootBounds.width ? viewport.width / rootBounds.width : 1, sy = rootBounds.height ? viewport.height / rootBounds.height : 1;
      host.portalTransforms.set(id, [1, 0, 0, 1, (bounds.left - rootBounds.left) * sx, (bounds.top - rootBounds.top) * sy]);
    }
  }
}

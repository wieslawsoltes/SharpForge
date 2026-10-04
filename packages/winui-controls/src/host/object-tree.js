/** Optional A15 object tree receives visual relationships and arranged geometry from this host. */
export function synchronizeObjectTree(host) {
  const tree = host.services.objectTree;
  if (!tree) return;
  for (const node of host.nodes.values()) tree.register(node.id);
  for (const [id, state] of host.layoutEngine.states) tree.setVisualParent(id, state.parent);
  const previous = host.connectedRoots ?? new Set();
  const current = new Set(host.windows);
  for (const id of previous) if (!current.has(id) && tree.contains(id)) tree.setConnected(id, false);
  for (const id of current) if (!previous.has(id)) tree.setConnected(id, true);
  host.connectedRoots = current;
}

export function updateObjectTreeBounds(host) {
  const tree = host.services.objectTree;
  if (!tree) return;
  for (const [id, layout] of host.worldLayout) tree.setBounds(id, layout.bounds);
}

/** Per-document identity allocation survives disposal of another root without process-global counters. */
export function allocateRootId(root, requested) {
  const allocated = new Set([...root.ownerDocument.querySelectorAll('[data-sf-root]')].map(element => element.dataset.sfRoot));
  if (requested != null) {
    if (allocated.has(String(requested))) throw new Error('SFUI1662: XamlRoot identifier is already active');
    return String(requested);
  }
  let index = 0;
  while (allocated.has('sf-root-' + index)) index++;
  return 'sf-root-' + index;
}

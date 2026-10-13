/**
 * Source offsets are part of compiler IDs. When display shape and order agree,
 * prepare new public IDs without sorting or cloning the unchanged tree nodes.
 * All maps and UI state are prepared before any current node is changed.
 */
export function prepareExplorerIdentities(model, updates) {
  const renames = new Map();
  for (const {entry, id} of updates) {
    if (entry.id === id) continue;
    for (const {node, prefix} of entry.nodes) {
      const next = prefix + id;
      if (!next || next.length > 8192) throw new Error('Tree IDs must be unique nonempty strings');
      if (next !== node.id) renames.set(node.id, next);
    }
  }
  if (!renames.size) return null;
  const renamed = id => renames.get(id) ?? id;
  const nodes = new Map(), parents = new Map(), changes = [];
  for (const [id, node] of model.nodes) {
    const next = renamed(id);
    if (nodes.has(next)) throw new Error('Tree IDs must be unique nonempty strings');
    nodes.set(next, node);
    if (next !== id) changes.push({node, id: next});
  }
  for (const [id, parent] of model.parents) parents.set(renamed(id), renamed(parent));
  const mapped = values => new Set([...values].map(renamed));
  return {renames, changes, nodes, parents,
    expanded: mapped(model.expanded), selected: mapped(model.selected), seen: mapped(model.seen ?? []),
    focused: renamed(model.focused), anchor: renamed(model.anchor)};
}

/** The caller updates source/dirty values and then sends one complete model notification. */
export function publishExplorerIdentities(model, plan) {
  if (!plan) return;
  for (const {node, id} of plan.changes) node.id = id;
  const {nodes, parents, expanded, selected, seen, focused, anchor} = plan;
  Object.assign(model, {nodes, parents, expanded, selected, seen, focused, anchor});
}

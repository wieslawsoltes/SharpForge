/** Render descriptive labels independently from tree topology; absent labels restore the normal visible-text accessible name. */
export function setTreeRowAttributes(element, row, selected) {
  const node = row.node;
  const attributes = {
    role: 'treeitem', 'aria-level': row.level, 'aria-posinset': row.pos, 'aria-setsize': row.size,
    'aria-selected': selected, 'data-tree-id': node.id, 'data-node-kind': node.kind ?? 'item',
    title: node.description ?? node.path ?? node.label, 'aria-label': node.accessibleName
  };
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) element.removeAttribute(name);
    else element.setAttribute(name, String(value));
  }
}

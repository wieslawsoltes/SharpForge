/** Session-local presentation state. It is deliberately excluded from document serialization and undo. */
export class DesignerOutlineState {
  constructor(document) {
    this.document = document;
    this.hidden = new Set();
    this.locked = new Set();
  }

  bind(document) {
    this.document = document;
    for (const id of this.hidden) if (!document.node(id)) this.hidden.delete(id);
    for (const id of this.locked) if (!document.node(id)) this.locked.delete(id);
  }

  inherited(set, id) {
    if (!set.size) return false;
    const visited = new Set();
    let node = this.document.node(id);
    while (node && !visited.has(node.id)) {
      if (set.has(node.id)) return true;
      visited.add(node.id);
      node = this.document.parent(node.id);
    }
    return false;
  }

  isVisible(id) {
    return !!this.document.node(id) && !this.inherited(this.hidden, id);
  }

  isLocked(id) {
    return this.inherited(this.locked, id);
  }

  toggle(id, kind) {
    if (!this.document.node(id)) throw new TypeError('Outline node no longer exists');
    if (!['hidden', 'locked'].includes(kind)) throw new TypeError('Unknown outline state');
    if (id === this.document.value.root && kind === 'hidden') throw new TypeError('The design root must remain visible');
    const values = this[kind];
    if (values.has(id)) values.delete(id);
    else values.add(id);
    return values.has(id);
  }

  filterSelection(ids) {
    return ids.filter(id => this.isVisible(id) && !this.isLocked(id));
  }

  assertEditable(ids) {
    if (this.document.readOnly) throw new Error('This source preview is read only. Open its source to change the document outline.');
    if (ids.some(id => this.isLocked(id))) throw new Error('Unlock the selected control before changing its structure or geometry');
  }
}

/** Reorders sibling or reparented controls as one transaction; rejects cycles and locked targets. */
export function moveOutlineNodes(document, state, ids, targetId, position = 'inside') {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) {
    throw new TypeError('Outline drag selection is invalid');
  }
  if (!['before', 'after', 'inside'].includes(position)) throw new TypeError('Unknown outline insertion position');
  if (ids.includes(document.value.root)) throw new TypeError('The design root cannot be moved');
  state.assertEditable([...ids, targetId]);
  const target = document.node(targetId);
  if (!target) throw new TypeError('Outline destination no longer exists');
  const parent = position === 'inside' ? target : document.parent(targetId);
  if (!parent) throw new TypeError('No insertion point exists outside the design root');
  state.assertEditable([parent.id]);
  const selected = new Set(ids);
  const roots = ids.filter(id => {
    for (let ancestor = document.parent(id); ancestor; ancestor = document.parent(ancestor.id)) {
      if (selected.has(ancestor.id)) return false;
    }
    return true;
  });
  for (const id of roots) {
    if (!document.node(id)) throw new TypeError('Dragged control no longer exists');
    for (let ancestor = parent; ancestor; ancestor = document.parent(ancestor.id)) {
      if (ancestor.id === id) throw new TypeError('A control cannot contain itself or its ancestor');
    }
  }
  const moved = new Set(roots);
  const originalIndex = parent.children.indexOf(targetId) + (position === 'after' ? 1 : 0);
  const before = position === 'inside' ? parent.children : parent.children.slice(0, originalIndex);
  const insertion = before.filter(id => !moved.has(id)).length;
  document.change('Reorder document outline', draft => {
    for (const node of draft.nodes) node.children = node.children.filter(id => !moved.has(id));
    draft.nodes.find(node => node.id === parent.id).children.splice(insertion, 0, ...roots);
  });
  document.select(roots);
  return roots;
}

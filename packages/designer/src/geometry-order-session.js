import {geometryInvariant} from './geometry-coordinates.js';

/** Repeated ordering remains a preview until commit; all selected controls move as a stable sibling block. */
export class DesignOrderSession {
  constructor(document, {ids = document.selection, canEdit = () => true, label = 'Order controls'} = {}) {
    document.assertActive();
    const parent = document.parent(ids[0]);
    geometryInvariant(ids.length && parent && ids.every(id => document.parent(id)?.id === parent.id),
      'SFD_ORDER_PARENT', 'Order commands require sibling controls.');
    geometryInvariant(!document.readOnly && [parent.id, ...ids].every(id => canEdit(id) !== false),
      'SFD_ORDER_READ_ONLY', 'Unlock the selected controls and their parent before changing their order.');
    this.document = document;
    this.revision = document.revision;
    this.parentId = parent.id;
    this.ids = [...ids];
    this.selected = new Set(ids);
    this.original = [...parent.children];
    this.next = [...parent.children];
    this.label = label;
    this.active = true;
  }

  update(direction) {
    geometryInvariant(this.active, 'SFD_ORDER_ENDED', 'The ordering gesture has ended.');
    geometryInvariant(['front', 'back', 'forward', 'backward'].includes(direction), 'SFD_ORDER_ACTION', 'Unknown order command.');
    const children = this.next;
    const selected = this.selected;
    if (direction === 'front' || direction === 'back') {
      const chosen = children.filter(id => selected.has(id));
      const others = children.filter(id => !selected.has(id));
      this.next = direction === 'front' ? [...others, ...chosen] : [...chosen, ...others];
    } else if (direction === 'forward') {
      for (let index = children.length - 2; index >= 0; index--) {
        if (selected.has(children[index]) && !selected.has(children[index + 1])) {
          [children[index], children[index + 1]] = [children[index + 1], children[index]];
        }
      }
    } else {
      for (let index = 1; index < children.length; index++) {
        if (selected.has(children[index]) && !selected.has(children[index - 1])) {
          [children[index], children[index - 1]] = [children[index - 1], children[index]];
        }
      }
    }
    return this.next;
  }

  commit() {
    geometryInvariant(this.active, 'SFD_ORDER_ENDED', 'The ordering gesture has ended.');
    this.active = false;
    if (this.next.every((id, index) => id === this.original[index])) return false;
    return this.document.change(this.label, candidate => {
      const nodes = new Map(candidate.nodes.map(node => [node.id, node]));
      const parent = nodes.get(this.parentId);
      parent.children = [...this.next];
      if (parent.type.endsWith('.Canvas')) parent.children.forEach((id, index) => { nodes.get(id).properties.ZIndex = index; });
    }, {expectedRevision: this.revision});
  }

  cancel() {
    this.active = false;
    this.next = [...this.original];
    return this.next;
  }

  dispose() { if (this.active) this.cancel(); }
}

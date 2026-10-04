import {childSlot} from '@sharpforge/designer';

const label = node => (node.properties.Name ? node.properties.Name + ' · ' : '') + node.type.split('.').at(-1);

/** Cache the structural tree by document/revision; selection costs only selected ancestor depth. */
export class DesignerOutlineProjection {
  constructor(view) {
    this.view = view;
    this.document = null;
    this.revision = -1;
    this.resources = null;
  }

  node(id) {
    const node = this.view.document.node(id);
    const container = !!childSlot(node.type);
    return {id, label: label(node), kind: 'control', icon: container ? '▰' : '◇', defaultExpanded: true,
      branch: container, dropTarget: container, draggable: id !== this.view.document.value.root,
      children: node.children.map(child => this.node(child))};
  }

  selection() {
    const model = this.view.treeModel;
    model.selected = new Set(this.view.resourceDocument ? [] : this.view.document.selection);
    for (const id of model.selected) {
      for (let parent = this.view.document.parent(id); parent; parent = this.view.document.parent(parent.id)) {
        if (!model.expanded.has(parent.id)) {
          model.expanded.add(parent.id);
          model.cachedRows = null;
        }
      }
    }
  }

  update(event = {}) {
    const {document, treeModel: model, resourceDocument: resources} = this.view;
    const sameOwner = this.document === document && this.resources === resources;
    const sameRevision = sameOwner && this.revision === document.revision;
    const propertiesOnly = sameOwner && this.revision + 1 === document.revision && event.changes?.kind === 'properties';
    this.selection();
    if (!sameRevision && propertiesOnly) {
      for (const change of event.changes.nodes) {
        if (!change.properties.includes('Name')) continue;
        const item = model.nodes.get(change.id);
        if (item) item.label = label(document.node(change.id));
        if (model.query) model.cachedRows = null;
      }
    } else if (!sameRevision || event.kind === 'load') {
      if (event.kind === 'load') model.seen = new Set();
      model.setNodes(resources ? [] : [this.node(document.value.root)]);
    }
    this.document = document;
    this.revision = document.revision;
    this.resources = resources;
  }
}

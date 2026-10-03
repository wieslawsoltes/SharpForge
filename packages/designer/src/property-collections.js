import {childSlot, normalizeProperty, propertySchema, track} from './model.js';
import {authoringError} from './property-diagnostics.js';
import {normalizeDesignerCollection} from './resource-validation.js';

/** A dialog edits an isolated draft; apply is one optimistic transaction, cancel has no side effects. */
export class DesignerCollectionDraft {
  constructor(document, id, property) {
    this.document = document;
    this.id = id;
    this.property = property;
    this.revision = document.revision;
    this.closed = false;
    const node = document.node(id);
    if (!node) authoringError('SFD1843', 'Unknown collection owner.');
    this.axis = property === 'RowDefinitions' ? 'rows' : property === 'ColumnDefinitions' ? 'columns' : null;
    this.maximum = this.axis ? 64 : 1000;
    this.owner = {type: node.type, children: [...node.children]};
    this.items = structuredClone(this.axis ? node[this.axis] ?? [] : node.collections?.[property] ?? []);
    if (!this.axis) normalizeDesignerCollection(node, property, this.items, {normalizeProperty, propertySchema, childSlot});
  }

  ensure() { if (this.closed) authoringError('SFD1843', 'The collection editor has closed.'); }

  normalize(value) {
    return this.axis ? track(value) : normalizeDesignerCollection(this.owner, this.property, [value],
      {normalizeProperty, propertySchema, childSlot})[0];
  }

  add(item, index = this.items.length) {
    this.ensure();
    if (!Number.isInteger(index) || index < 0 || index > this.items.length) authoringError('SFD1843', 'Invalid insertion index.');
    if (this.items.length >= this.maximum) authoringError('SFD1843', `Collection limit: ${this.maximum} entries.`);
    this.items.splice(index, 0, this.normalize(item));
  }

  remove(index) {
    this.ensure();
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) authoringError('SFD1843', 'Invalid collection index.');
    this.items.splice(index, 1);
  }

  move(index, target) {
    this.ensure();
    if (![index, target].every(value => Number.isInteger(value) && value >= 0 && value < this.items.length)) {
      authoringError('SFD1843', 'Invalid collection move.');
    }
    this.items.splice(target, 0, this.items.splice(index, 1)[0]);
  }

  set(index, value) {
    this.ensure();
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) authoringError('SFD1843', 'Invalid collection index.');
    this.items[index] = this.normalize(value);
  }

  apply() {
    this.ensure();
    const changed = this.document.change('Edit ' + this.property, design => {
      const node = design.nodes.find(candidate => candidate.id === this.id);
      if (this.axis) node[this.axis] = this.items.map(track);
      else (node.collections ??= {})[this.property] = normalizeDesignerCollection(node, this.property, this.items,
        {normalizeProperty, propertySchema, childSlot});
    }, {expectedRevision: this.revision});
    this.closed = true;
    return changed;
  }

  cancel() { this.closed = true; }
}

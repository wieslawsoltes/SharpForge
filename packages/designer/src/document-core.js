import {
  addControl, deleteControls, moveControl, duplicateControl, pasteControls,
  groupControls, ungroupControls
} from './document-tree.js';
import {immutableDesignData} from './document-data.js';
import {DesignerPropertyBaseline} from './document-property-baseline.js';
import {patchDocumentProperties, restoreDocumentProperties} from './document-property-patches.js';

const clone = value => structuredClone(value);

/** Transactional document state. Validators are injected to keep model dependencies acyclic. */
export class DesignDocumentCore {
  constructor(value, options) {
    this.contracts = options.contracts;
    this.historyLimit = options.historyLimit ?? 100;
    this.historyByteLimit = options.historyByteLimit ?? 32 * 1024 * 1024;
    if (!Number.isInteger(this.historyLimit) || this.historyLimit < 0 || this.historyLimit > 1000) {
      throw new RangeError('History limit must be an integer between 0 and 1000');
    }
    if (!Number.isFinite(this.historyByteLimit) || this.historyByteLimit < 0) {
      throw new RangeError('History byte limit must be nonnegative');
    }
    this.value = this.contracts.validate(value);
    this.revision = 0;
    this.savedRevision = 0;
    this.selection = [this.value.root];
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.disposed = false;
    this.readOnly = false;
    this.readOnlyReason = '';
    this.transaction = null;
    this.reindex();
    this.propertyBaseline = new DesignerPropertyBaseline(this.value);
  }

  /** O(n) after a commit; node and parent queries are O(1) between commits. */
  reindex() {
    this.nodesById = new Map();
    this.parentsById = new Map();
    this.nodePositions = new Map();
    for (const [index, node] of this.value.nodes.entries()) {
      this.nodesById.set(node.id, node);
      this.nodePositions.set(node.id, index);
      for (const child of node.children) this.parentsById.set(child, node.id);
    }
  }

  assertActive() {
    if (this.disposed) throw new Error('Design document is disposed');
  }

  /** Source previews may prohibit authoring without blocking selection, source refresh, or resource staging in other documents. */
  setReadOnly(value, reason = 'This source preview is read-only.') {
    this.assertActive();
    if (typeof value !== 'boolean' || typeof reason !== 'string') throw new TypeError('Read-only state requires a Boolean and reason.');
    const changed = this.readOnly !== value || this.readOnlyReason !== (value ? reason : '');
    this.readOnly = value;
    this.readOnlyReason = value ? reason : '';
    if (value) this.transaction?.cancel();
    if (changed) this.notify('capability');
  }

  assertWritable() {
    this.assertActive();
    if (this.readOnly) throw Object.assign(new Error(this.readOnlyReason), {code: 'SFD1865', severity: 'error', source: 'Designer'});
  }

  subscribe(listener) {
    this.assertActive();
    if (typeof listener !== 'function') throw new TypeError('Document listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(kind, changes) {
    const event = {kind, revision: this.revision, selection: [...this.selection], ...(changes ? {changes} : {})};
    for (const listener of [...this.listeners]) listener(event);
  }

  snapshot() { return clone(this.value); }
  node(id = this.selection[0]) { return this.nodesById.get(id); }
  parent(id) { return this.nodesById.get(this.parentsById.get(id)); }

  select(ids) {
    this.assertActive();
    const values = typeof ids === 'string' ? [ids] : ids;
    if (!Array.isArray(values) || values.some(id => !this.nodesById.has(id))) {
      throw new TypeError('Unknown selection');
    }
    this.selection = [...new Set(values.length ? values : [this.value.root])];
    this.notify('selection');
  }

  historyEntry(label) {
    const value = clone(this.value);
    return immutableDesignData({label, value, selection: [...this.selection], bytes: JSON.stringify(value).length * 2});
  }

  trimHistory(stack) {
    let bytes = stack.reduce((total, entry) => total + (entry.bytes ?? 0), 0);
    while (stack.length && (stack.length > this.historyLimit || bytes > this.historyByteLimit)) {
      bytes -= stack.shift().bytes ?? 0;
    }
  }

  /** Validate an isolated candidate before publishing one revision and one history entry. */
  change(label, edit, { expectedRevision = this.revision } = {}) {
    this.assertWritable();
    if (expectedRevision !== this.revision) throw new Error('Design changed; refresh before applying this edit');
    if (typeof edit !== 'function') throw new TypeError('Document edit must be a function');
    const candidate = this.snapshot();
    edit(candidate);
    const valid = this.contracts.validate(candidate);
    if (JSON.stringify(valid) === JSON.stringify(this.value)) return false;
    this.undoStack.push(this.historyEntry(label));
    this.trimHistory(this.undoStack);
    this.redoStack.length = 0;
    this.value = valid;
    this.reindex();
    this.propertyBaseline.reset(valid);
    this.revision++;
    this.selection = this.selection.filter(id => this.nodesById.has(id));
    if (!this.selection.length) this.selection = [valid.root];
    this.notify(label);
    return true;
  }

  /** Replace the source-derived preview while optionally retaining the document history. */
  load(value, { label = 'source sync', history = false, selection = this.selection } = {}) {
    this.assertActive();
    const valid = this.contracts.validate(value);
    if (history) this.undoStack.push(this.historyEntry(label));
    else { this.undoStack.length = 0; this.redoStack.length = 0; }
    this.trimHistory(this.undoStack);
    this.value = valid;
    this.reindex();
    this.propertyBaseline.reset(valid);
    this.selection = selection.filter(id => this.nodesById.has(id));
    if (!this.selection.length) this.selection = [valid.root];
    this.revision++;
    this.notify(label);
  }

  undo(redo = false) {
    this.assertWritable();
    const source = redo ? this.redoStack : this.undoStack;
    const destination = redo ? this.undoStack : this.redoStack;
    const entry = source.at(-1);
    if (!entry) return false;
    if (['properties', 'property-document'].includes(entry.kind)) return restoreDocumentProperties(this, entry, source, destination, redo);
    source.pop();
    destination.push(this.historyEntry(entry.label));
    this.trimHistory(destination);
    this.value = clone(entry.value);
    this.selection = [...entry.selection];
    this.reindex();
    this.propertyBaseline.reset(this.value);
    this.revision++;
    this.notify(redo ? 'redo' : 'undo');
    return true;
  }

  /** A gesture stages arbitrary previews but publishes only its final candidate. */
  beginTransaction(label) {
    this.assertWritable();
    if (this.transaction) throw new Error('A document transaction is already active');
    const startRevision = this.revision;
    let candidate = this.snapshot();
    let closed = false;
    const assertOpen = () => {
      if (closed || this.disposed) throw new Error('Document transaction is closed');
      this.assertWritable();
      if (this.revision !== startRevision) throw new Error('Design changed during transaction');
    };
    const transaction = {
      stage: edit => { assertOpen(); const next = clone(candidate); edit(next); candidate = this.contracts.validate(next); },
      snapshot: () => { assertOpen(); return clone(candidate); },
      commit: () => {
        assertOpen();
        closed = true;
        this.transaction = null;
        return this.change(label, next => {
          for (const key of Object.keys(next)) delete next[key];
          Object.assign(next, candidate);
        }, { expectedRevision: startRevision });
      },
      cancel: () => { closed = true; if (this.transaction === transaction) this.transaction = null; }
    };
    this.transaction = transaction;
    return transaction;
  }

  setProperty(name, value, ids = this.selection) {
    return this.change('Set ' + name, document => {
      const nodes = new Map(document.nodes.map(node => [node.id, node]));
      for (const id of ids) {
        const node = nodes.get(id);
        if (!node) throw new TypeError('Unknown property target ' + id);
        if (value === undefined) delete node.properties[name];
        else node.properties[name] = this.contracts.normalize(node.type, name, value);
      }
    });
  }

  /** Atomic local-property patches emit exact changed-key deltas when the validated structure remains unchanged. */
  patchProperties(changes, options) { return patchDocumentProperties(this, changes, options); }

  setReference(property, value, ids = this.selection) {
    if (!['style', 'template'].includes(property)) throw new TypeError('Invalid reference');
    return this.change('Set ' + property, document => {
      const nodes = new Map(document.nodes.map(node => [node.id, node]));
      for (const id of ids) {
        const node = nodes.get(id);
        if (!node) throw new TypeError('Unknown reference target ' + id);
        if (value) node[property] = value;
        else delete node[property];
      }
    });
  }

  add(type, parentId = this.selection[0], properties = {}) { return addControl(this, type, parentId, properties); }
  remove(ids = this.selection) { return deleteControls(this, ids); }
  move(id, parentId, index) { return moveControl(this, id, parentId, index); }
  duplicate(id = this.selection[0]) { return duplicateControl(this, id); }
  paste(input, selected, parentId = this.selection[0]) { return pasteControls(this, input, selected, parentId); }
  group(type, ids = this.selection) { return groupControls(this, type, ids); }
  ungroup(id = this.selection[0]) { return ungroupControls(this, id); }

  geometry(rectangles, options) { return this.patchProperties(rectangles, {label: 'Move / resize controls', ...options}); }

  tracks(id, rows, columns) {
    return this.change('Edit Grid tracks', document => {
      const node = document.nodes.find(item => item.id === id);
      if (!node) throw new TypeError('Unknown Grid ' + id);
      node.rows = rows.map(this.contracts.track);
      node.columns = columns.map(this.contracts.track);
    });
  }

  setResource(table, name, value) {
    if (!/^[A-Za-z_]\w*$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) {
      throw new TypeError('Invalid resource key');
    }
    return this.change('Edit ' + table, document => {
      if (value === null) delete document[table][name];
      else document[table][name] = clone(value);
    });
  }

  setStyle(name, value) { return this.setResource('styles', name, value); }
  setTemplate(name, value) { return this.setResource('templates', name, value); }
  serialize() { return JSON.stringify(this.value, null, 2) + '\n'; }

  dispose() {
    if (this.disposed) return;
    this.transaction?.cancel();
    this.listeners.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.disposed = true;
  }
}

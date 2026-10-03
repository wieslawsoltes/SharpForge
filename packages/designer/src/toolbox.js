import {DesignDocument, childSlot, designControls} from './model.js';
import {canonicalType, CONTROLS} from '@sharpforge/framework';
import {discoverProjectControls, validateProjectControl} from './toolbox-project-types.js';

const common = new Set(['Grid', 'StackPanel', 'Canvas', 'Border', 'TextBlock', 'TextBox', 'Button', 'CheckBox', 'ComboBox', 'Image']);

/** Finds an accepting descendant container before ascending from a full content root. O(nodes). */
export function toolboxInsertionParent(document, {selected = document.selection[0], accepts = () => true} = {}) {
  const nodes = new Map(document.value.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of nodes.values()) for (const child of node.children) parents.set(child, node.id);
  const visited = new Set();
  let current = nodes.get(selected);
  if (!current) throw new TypeError('Select a control in the document before inserting');
  while (current) {
    const slot = childSlot(current.type);
    if (slot && (slot.many || !current.children.length) && accepts(current.id)) return current;
    if (slot && !slot.many) {
      const pending = [...current.children];
      for (let index = 0; index < pending.length; index++) {
        const descendant = nodes.get(pending[index]);
        if (!descendant || visited.has(descendant.id)) continue;
        visited.add(descendant.id);
        const target = childSlot(descendant.type);
        if (target?.many && accepts(descendant.id)) return descendant;
        pending.push(...descendant.children);
      }
    }
    current = nodes.get(parents.get(current.id));
  }
  throw new TypeError('No unlocked layout container accepts this control');
}

/** Per-workspace catalog. Failed analysis never replaces the last successful custom type set. */
export class DesignerToolboxCatalog {
  constructor({recentLimit = 12} = {}) {
    if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 64) throw new RangeError('Invalid toolbox recent limit');
    this.recentLimit = recentLimit;
    this.project = new Map();
    this.recent = [];
    this.customTabs = new Map();
    this.version = -1;
    this.controls = new Map(designControls.filter(control => control.name !== 'Window').map(control => [control.type, control]));
  }

  updateAnalysis(analysis) {
    if (!analysis?.success) return false;
    if (Number.isFinite(analysis.version) && analysis.version <= this.version) return false;
    const discovered = discoverProjectControls(analysis);
    const project = new Map(discovered.map(control => [control.type, {
      ...control, name: control.displayName, category: 'Project', project: true
    }]));
    this.project = project;
    this.version = analysis.version ?? this.version + 1;
    this.recent = this.recent.filter(type => this.controls.has(type) || project.has(type));
    return true;
  }

  tabs() {
    return [{id: 'common', label: 'Common'}, {id: 'all', label: 'All WinUI'},
      {id: 'project', label: 'Project'}, {id: 'recent', label: 'Recent'},
      ...[...this.customTabs].map(([id, value]) => ({id, label: value.label}))];
  }

  addTab(id, label, types) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(id) || this.tabs().some(tab => tab.id === id)) throw new TypeError('Toolbox tab id must be unique');
    if (this.customTabs.size >= 16 || typeof label !== 'string' || !label.trim() || label.length > 80) {
      throw new RangeError('Toolbox custom tab limit exceeded');
    }
    if (!Array.isArray(types) || types.length > 512) throw new RangeError('Toolbox tab item limit exceeded');
    const values = types.map(type => this.control(type).type);
    this.customTabs.set(id, {label, types: [...new Set(values)]});
  }

  control(type) {
    const control = this.project.get(type) ?? this.controls.get(canonicalType(type));
    if (!control) throw new TypeError('Control is not available in this toolbox: ' + type);
    return control;
  }

  items(tab = 'common', search = '') {
    const query = String(search).trim().toLocaleLowerCase().slice(0, 256);
    let values;
    if (tab === 'all') values = [...this.controls.values()];
    else if (tab === 'project') values = [...this.project.values()];
    else if (tab === 'recent') values = this.recent.map(type => this.control(type));
    else if (tab === 'common') values = [...this.controls.values()].filter(control => common.has(control.name));
    else if (this.customTabs.has(tab)) values = this.customTabs.get(tab).types
      .filter(type => this.controls.has(type) || this.project.has(type)).map(type => this.control(type));
    else throw new TypeError('Unknown toolbox tab');
    return values.filter(control => (control.name + ' ' + control.type + ' ' + control.category).toLocaleLowerCase().includes(query));
  }

  used(type) {
    const canonical = this.control(type).type;
    this.recent = [canonical, ...this.recent.filter(item => item !== canonical)].slice(0, this.recentLimit);
  }
}

/** Inserts a framework/project control with one undo item and selects its new node. */
export function insertToolboxControl(document, catalog, type, {properties = {}, accepts, parentId, recordRecent = true} = {}) {
  const control = catalog.control(type);
  const parent = parentId ? document.node(parentId) : toolboxInsertionParent(document, {accepts});
  if (!parent) throw new TypeError('Toolbox insertion target no longer exists');
  if (accepts && !accepts(parent.id)) throw new TypeError('Toolbox insertion target is locked or hidden');
  if (!control.project) {
    const id = document.add(control.type, parent.id, properties);
    if (recordRecent) catalog.used(control.type);
    return id;
  }
  const descriptor = validateProjectControl(control);
  const candidate = new DesignDocument(document.snapshot());
  const defaults = parent.type === CONTROLS + 'Canvas' ? {Width: 180, Height: 100} : {};
  const id = candidate.add(descriptor.baseType, parent.id, {...defaults, ...properties});
  const value = candidate.snapshot();
  const node = value.nodes.find(node => node.id === id);
  node.projectType = descriptor.type;
  delete node.properties.Content;
  value.projectTypes = [...(value.projectTypes ?? []).filter(item => item.type !== descriptor.type), descriptor];
  document.change('Insert ' + descriptor.displayName, draft => Object.assign(draft, value));
  document.select(id);
  if (recordRecent) catalog.used(control.type);
  return id;
}

import { canonicalType, propertiesFor, CONTROLS, XAML } from '@sharpforge/framework';
import { cloneSubtrees } from './document-clipboard.js';
import {pruneDesignerAuthoring} from './resource-node-references.js';

const shortName = type => type.slice(type.lastIndexOf('.') + 1);

/** Find a legal insertion container, including the existing content under a Window root. */
export function insertionParent(document, id, count = 1) {
  let node = document.node(id);
  const seen = new Set();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const slot = document.contracts.childSlot(node.type);
    if (slot && (slot.many || node.children.length + count <= 1)) return node;
    if (slot && !slot.many && node.children.length === 1) {
      const child = document.node(node.children[0]);
      if (document.contracts.childSlot(child?.type)) { node = child; continue; }
    }
    node = document.parent(node.id);
  }
  throw new TypeError('Select a container with room for the controls');
}

export function addControl(document, requestedType, parentId, properties) {
  const type = canonicalType(requestedType);
  const parent = insertionParent(document, parentId);
  let suffix = 1;
  let id = shortName(type).replace(/\W/g, '') + '_' + suffix;
  while (document.node(id)) id = shortName(type) + '_' + (++suffix);
  document.change('Add ' + shortName(type), next => {
    const container = next.nodes.find(node => node.id === parent.id);
    const schema = propertiesFor(type);
    const defaults = {};
    if (schema.Name) defaults.Name = id;
    if (schema.Text) defaults.Text = shortName(type);
    else if (schema.Content) defaults.Content = shortName(type);
    if (parent.type === CONTROLS + 'Canvas') Object.assign(defaults, { Left: 48, Top: 240, Width: 180, Height: 40 });
    container.children.push(id);
    next.nodes.push({ id, type, properties: { ...defaults, ...properties }, children: [], events: {} });
  });
  document.select(id);
  return id;
}

export function deleteControls(document, ids) {
  if (!Array.isArray(ids) || ids.some(id => !document.node(id))) throw new TypeError('Unknown deletion target');
  if (ids.includes(document.value.root)) throw new TypeError('Cannot delete the root');
  return document.change('Delete controls', next => {
    const nodes = new Map(next.nodes.map(node => [node.id, node]));
    const removed = new Set();
    const pending = [...ids];
    while (pending.length) {
      const id = pending.pop();
      if (removed.has(id)) continue;
      removed.add(id);
      pending.push(...nodes.get(id).children);
    }
    next.nodes = next.nodes.filter(node => !removed.has(node.id));
    for (const node of next.nodes) node.children = node.children.filter(id => !removed.has(id));
    pruneDesignerAuthoring(next, removed);
  });
}

export function moveControl(document, id, parentId, index) {
  if (id === document.value.root) throw new TypeError('Cannot move the root');
  return document.change('Reparent control', next => {
    const nodes = new Map(next.nodes.map(node => [node.id, node]));
    const parent = nodes.get(parentId);
    if (!nodes.has(id) || !parent) throw new TypeError('Missing move target');
    for (const node of next.nodes) node.children = node.children.filter(child => child !== id);
    const position = index ?? parent.children.length;
    if (!Number.isInteger(position) || position < 0 || position > parent.children.length) {
      throw new RangeError('Insertion index is outside the container');
    }
    parent.children.splice(position, 0, id);
  });
}

export function duplicateControl(document, id) {
  if (id === document.value.root) throw new TypeError('Cannot duplicate the root');
  const parent = document.parent(id);
  if (!parent) throw new TypeError('Unknown duplicate target');
  let inserted;
  document.change('Duplicate controls', next => {
    inserted = cloneSubtrees(document.value, next, [id], { offset: 16 });
    next.nodes.find(node => node.id === parent.id).children.push(...inserted);
  });
  document.select(inserted);
  return inserted[0];
}

export function pasteControls(document, input, selected, parentId) {
  const source = document.contracts.validate(input);
  const nodes = new Map(source.nodes.map(node => [node.id, node]));
  if (!Array.isArray(selected) || !selected.length || selected.some(id => !nodes.has(id))) {
    throw new TypeError('Invalid clipboard selection');
  }
  const parents = new Map();
  for (const node of source.nodes) for (const child of node.children) parents.set(child, node.id);
  const selectedSet = new Set(selected);
  const roots = selected.filter(id => {
    let current = parents.get(id);
    while (current) { if (selectedSet.has(current)) return false; current = parents.get(current); }
    return true;
  });
  if (roots.some(id => nodes.get(id).type === XAML + 'Window')) throw new TypeError('Cannot paste a Window inside a control');
  const parent = insertionParent(document, parentId, roots.length);
  let inserted;
  document.change('Paste controls', next => {
    inserted = cloneSubtrees(source, next, roots);
    next.nodes.find(node => node.id === parent.id).children.push(...inserted);
  });
  document.select(inserted);
  return inserted;
}

export function groupControls(document, requestedType = CONTROLS + 'Canvas', ids) {
  const type = canonicalType(requestedType);
  if (!['Canvas', 'Grid', 'StackPanel'].includes(shortName(type))) throw new TypeError('Grouping requires a layout panel');
  if (!ids.length || ids.includes(document.value.root)) throw new TypeError('Select child controls to group');
  const parent = document.parent(ids[0]);
  if (!parent || ids.some(id => document.parent(id)?.id !== parent.id)) throw new TypeError('Grouped controls must share a parent');
  let suffix = 1;
  let id = 'Group_' + suffix;
  while (document.node(id)) id = 'Group_' + (++suffix);
  document.change('Group controls', next => {
    const nodes = new Map(next.nodes.map(node => [node.id, node]));
    const container = nodes.get(parent.id);
    const chosen = new Set(ids);
    const children = container.children.filter(child => chosen.has(child));
    const position = container.children.indexOf(children[0]);
    const properties = { Name: id };
    if (type === CONTROLS + 'Canvas' && parent.type === CONTROLS + 'Canvas') {
      const items = children.map(child => nodes.get(child));
      const left = Math.min(...items.map(node => node.properties.Left ?? 0));
      const top = Math.min(...items.map(node => node.properties.Top ?? 0));
      properties.Left = left;
      properties.Top = top;
      properties.Width = Math.max(...items.map(node => (node.properties.Left ?? 0) + (node.properties.Width ?? 100))) - left;
      properties.Height = Math.max(...items.map(node => (node.properties.Top ?? 0) + (node.properties.Height ?? 30))) - top;
      for (const node of items) { node.properties.Left = (node.properties.Left ?? 0) - left; node.properties.Top = (node.properties.Top ?? 0) - top; }
    }
    container.children = container.children.filter(child => !chosen.has(child));
    container.children.splice(position, 0, id);
    next.nodes.push({ id, type, properties, children, events: {} });
  });
  document.select(id);
  return id;
}

export function ungroupControls(document, id) {
  const node = document.node(id);
  const parent = document.parent(id);
  if (!parent || !['Canvas', 'Grid', 'StackPanel'].includes(shortName(node.type))) {
    throw new TypeError('Select a grouped layout panel');
  }
  const children = [...node.children];
  document.change('Ungroup controls', next => {
    const nodes = new Map(next.nodes.map(item => [item.id, item]));
    const container = nodes.get(parent.id);
    if (node.type === CONTROLS + 'Canvas' && parent.type === CONTROLS + 'Canvas') {
      for (const child of children) {
        const item = nodes.get(child);
        item.properties.Left = (item.properties.Left ?? 0) + (node.properties.Left ?? 0);
        item.properties.Top = (item.properties.Top ?? 0) + (node.properties.Top ?? 0);
      }
    }
    container.children.splice(container.children.indexOf(id), 1, ...children);
    next.nodes = next.nodes.filter(item => item.id !== id);
    pruneDesignerAuthoring(next, [id]);
  });
  document.select(children.length ? children : [parent.id]);
  return children;
}

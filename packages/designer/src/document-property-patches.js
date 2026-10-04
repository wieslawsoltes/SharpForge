import {immutableDesignData} from './document-data.js';
import {applyPropertyInputs, assertPropertyPatchPermission, normalizedPropertyInputs, propertyPatchEntries} from './document-property-values.js';

const same = (left, right) => left === right || JSON.stringify(left) === JSON.stringify(right);

function assertRevision(document, expectedRevision) {
  document.assertWritable();
  if (document.revision !== expectedRevision) throw new Error('Design changed; refresh before applying this edit');
}

function canIncrement(document, entries) {
  const contract = document.contracts.propertyPatch;
  return contract?.validate === document.contracts.validate && contract.normalize === document.contracts.normalize
    && entries.every(([, properties]) => properties.every(([key]) => !['Name', 'Content'].includes(key)))
    && document.propertyBaseline.matches(document.value, document.nodesById);
}

function capturedValues(node, properties) {
  const values = properties.map(name => {
    const present = Object.hasOwn(node.properties, name);
    return {name, present, ...(present ? {value: structuredClone(node.properties[name])} : {})};
  });
  return {id: node.id, type: node.type, ...(node.projectType === undefined ? {} : {projectType: node.projectType}),
    properties: values};
}

function prepareIncrement(document, entries) {
  const updates = [];
  const target = [];
  const reverse = [];
  for (const [id, input] of entries) {
    const original = document.node(id);
    if (!original) throw new TypeError('Unknown property target ' + id);
    const normalized = normalizedPropertyInputs(original, input, document.contracts);
    const changed = normalized.filter(([key, value]) => value === undefined ? Object.hasOwn(original.properties, key)
      : !Object.hasOwn(original.properties, key) || !same(value, original.properties[key]));
    if (!changed.length) continue;
    const node = {...original, properties: {...original.properties}};
    applyPropertyInputs(node, changed);
    const keys = changed.map(([key]) => key);
    updates.push({index: document.nodePositions.get(id), node, properties: keys});
    target.push(capturedValues(original, keys));
    reverse.push(capturedValues(node, keys));
  }
  const nodes = document.value.nodes.slice();
  for (const {index, node} of updates) nodes[index] = node;
  return {value: {...document.value, nodes}, updates, target, reverse, baseline: document.propertyBaseline.prepare(updates),
    changes: immutableDesignData({kind: 'properties', nodes: updates.map(({node, properties}) => ({id: node.id, properties}))})};
}

function historyEntry(label, target, reverse, selection, kind = 'properties') {
  const entry = {kind, label, target, reverse, selection: [...selection]};
  entry.bytes = JSON.stringify(entry).length * 2;
  return immutableDesignData(entry);
}

function finishCommit(document, prepared, entry, label) {
  document.undoStack.push(entry);
  document.trimHistory(document.undoStack);
  document.redoStack.length = 0;
  publish(document, prepared);
  document.revision++;
  document.notify(label, prepared.changes);
  return true;
}

function publish(document, prepared) {
  document.value = prepared.value;
  if (prepared.updates) {
    for (const {node} of prepared.updates) document.nodesById.set(node.id, node);
    document.propertyBaseline.commit(prepared.baseline);
  } else {
    document.reindex();
    document.propertyBaseline.reset(document.value);
  }
  document.selection = document.selection.filter(id => document.nodesById.has(id));
  if (!document.selection.length) document.selection = [document.value.root];
}

function editFullCandidate(document, candidate, entries) {
  const nodes = new Map(candidate.nodes.map(node => [node.id, node]));
  for (const [id, input] of entries) {
    const node = nodes.get(id);
    if (!node) throw new TypeError('Unknown property target ' + id);
    applyPropertyInputs(node, normalizedPropertyInputs(node, input, document.contracts));
  }
}

/** Local property changes preserve structure and competing value sources; arbitrary edits retain the full validator. */
export function patchDocumentProperties(document, input, {label = 'Edit properties', expectedRevision = document.revision, canEdit} = {}) {
  assertRevision(document, expectedRevision);
  if (typeof label !== 'string' || !label.length || label.length > 256) throw new TypeError('Invalid property edit label');
  if (canEdit !== undefined && typeof canEdit !== 'function') throw new TypeError('Property permission must be a function');
  const entries = propertyPatchEntries(input);
  if (!entries.some(([, properties]) => properties.length)) return false;
  assertPropertyPatchPermission(entries, canEdit);
  assertRevision(document, expectedRevision);
  if (!canIncrement(document, entries)) {
    const before = document.snapshot();
    const candidate = structuredClone(before);
    editFullCandidate(document, candidate, entries);
    const valid = document.contracts.validate(candidate);
    assertRevision(document, expectedRevision);
    if (same(valid, document.value)) return false;
    const entry = historyEntry(label, before, structuredClone(valid), document.selection, 'property-document');
    return finishCommit(document, {value: valid}, entry, label);
  }
  const prepared = prepareIncrement(document, entries);
  assertRevision(document, expectedRevision);
  if (!prepared.updates.length) return false;
  const entry = historyEntry(label, prepared.target, prepared.reverse, document.selection);
  return finishCommit(document, prepared, entry, label);
}

function historyInputs(document, entry) {
  let currentNodes;
  return entry.target.map(target => {
    let node = document.value.nodes[document.nodePositions.get(target.id)];
    if (node?.id !== target.id) {
      currentNodes ??= new Map(document.value.nodes.map(item => [item.id, item]));
      node = currentNodes.get(target.id);
    }
    if (!node || node.type !== target.type || node.projectType !== target.projectType) {
      throw new Error('Design changed; a property history target is missing or has another type');
    }
    return [target.id, target.properties.map(property => [property.name,
      property.present ? structuredClone(property.value) : undefined])];
  });
}

function restoredPropertyDocument(document, value) {
  const current = new Map(document.value.nodes.map(node => [node.id, node]));
  const candidate = structuredClone(value);
  for (const node of candidate.nodes) {
    const live = current.get(node.id);
    if (live?.type !== node.type || live.projectType !== node.projectType) continue;
    for (const key of ['runtimeId', 'baseProperties']) {
      delete node[key];
      if (Object.hasOwn(live, key)) node[key] = structuredClone(live[key]);
    }
  }
  return {value: document.contracts.validate(candidate)};
}

/** Undo records contain detached forward and inverse values, so public mutable aliases cannot rewrite either direction. */
export function restoreDocumentProperties(document, entry, source, destination, redo) {
  const revision = document.revision;
  let prepared;
  if (entry.kind === 'property-document') prepared = restoredPropertyDocument(document, entry.target);
  else {
    const entries = historyInputs(document, entry);
    if (canIncrement(document, entries)) prepared = prepareIncrement(document, entries);
    else {
      const candidate = document.snapshot();
      editFullCandidate(document, candidate, entries);
      prepared = {value: document.contracts.validate(candidate)};
    }
  }
  assertRevision(document, revision);
  const inverse = historyEntry(entry.label, entry.reverse, entry.target, document.selection, entry.kind);
  source.pop();
  destination.push(inverse);
  document.trimHistory(destination);
  publish(document, prepared);
  document.selection = entry.selection.filter(id => document.nodesById.has(id));
  if (!document.selection.length) document.selection = [document.value.root];
  document.revision++;
  document.notify(redo ? 'redo' : 'undo', prepared.changes);
  return true;
}

import {childSlot, validateDesign} from './model.js';

/** Exact source/runtime ownership mismatches never authorize C# writeback. */
export class LiveSourceBindingError extends Error {
  constructor(reason, nodeId) {
    super('The linked C# design cannot attach safely: ' + reason + '. Open a separate live design to inspect this app.');
    this.name = 'LiveSourceBindingError';
    this.code = 'SFDL0009';
    this.source = 'Designer';
    this.severity = 'error';
    this.reason = reason;
    this.nodeId = nodeId;
    this.fixHint = 'Keep the source link, or open a separate live design without C# writeback.';
  }
}

function reject(reason, nodeId) {
  throw new LiveSourceBindingError(reason, nodeId);
}

function indexRuntime(document, scene) {
  const raw = new Map();
  if (scene) {
    if (!Array.isArray(scene.nodes) || scene.nodes.length > 10_000) reject('the running scene exceeds the supported inspection limit');
    for (const node of scene.nodes) {
      if (!node || typeof node !== 'object') reject('the running scene contains an invalid control');
      if (raw.has(node.id)) reject('the running scene contains duplicate control identities');
      raw.set(node.id, node);
    }
  }
  const nodes = new Map();
  const runtimeIds = new Set();
  const names = new Map();
  for (const node of document.nodes) {
    const runtimeId = node.runtimeId;
    if (!['string', 'number'].includes(typeof runtimeId) || String(runtimeId).length > 256 || String(runtimeId) === '' ||
      typeof runtimeId === 'number' && (!Number.isSafeInteger(runtimeId) || runtimeId < 0)) {
      reject('a running control has no stable runtime identity', node.id);
    }
    if (runtimeIds.has(runtimeId)) reject('running controls share one runtime identity', node.id);
    runtimeIds.add(runtimeId);
    const captured = raw.get(runtimeId);
    if (scene && !captured) reject('a control is missing from the running scene', node.id);
    const name = captured?.properties?.Name ?? node.properties.Name ?? node.baseProperties?.Name ?? '';
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
    nodes.set(node.id, {node, captured, name, type: captured?.type ?? node.projectType ?? node.type});
  }
  return {nodes, names};
}

function checkOwnedChildren(entry, runtimeNodes) {
  const slot = childSlot(entry.node.type);
  if (!entry.captured || !slot) return;
  if (slot.property === 'Items' && Object.hasOwn(entry.node.collections ?? {}, 'Items')) return;
  const values = slot.many ? entry.captured.collections?.[slot.property] ?? [] : [entry.captured.properties?.[slot.property]];
  if (!Array.isArray(values)) reject('the running child collection is malformed', entry.node.id);
  const references = values.filter(value => value && Object.hasOwn(value, '$ref')).map(value => value.$ref);
  if (references.length !== entry.node.children.length || references.some((id, index) =>
    runtimeNodes.get(entry.node.children[index])?.node.runtimeId !== id)) {
    reject('the running ownership tree contains unsupported or uncaptured children', entry.node.id);
  }
}

function mapOwnedTree(source, runtime, scene) {
  const sourceNodes = new Map(source.nodes.map(node => [node.id, node]));
  const indexed = indexRuntime(runtime, scene);
  const root = sourceNodes.get(source.root);
  const expectedType = node => node.projectType ?? node.type;
  const candidates = [...indexed.nodes.values()].filter(entry =>
    entry.type === expectedType(root) && entry.name === (root.properties.Name ?? ''));
  if (candidates.length !== 1) {
    reject(candidates.length ? 'more than one running control could own this source tree' : 'no running control matches the source root', root.id);
  }
  const pending = [[root, candidates[0]]];
  const bindings = new Map();
  const matchedRuntimeIds = new Set();
  while (pending.length) {
    const [node, entry] = pending.pop();
    if (!entry || entry.type !== expectedType(node) || entry.name !== (node.properties.Name ?? '')) {
      reject('a control name or type differs in the owned tree', node.id);
    }
    if (entry.name && indexed.names.get(entry.name) > 1) reject('the running scene contains the duplicate name ' + entry.name, node.id);
    if (matchedRuntimeIds.has(entry.node.runtimeId)) reject('the ownership tree has an ambiguous control identity', node.id);
    matchedRuntimeIds.add(entry.node.runtimeId);
    if (entry.node.children.length !== node.children.length) reject('the source and running control have different child counts', node.id);
    checkOwnedChildren(entry, indexed.nodes);
    bindings.set(node.id, entry.node.runtimeId);
    const children = entry.node.children.map(id => indexed.nodes.get(id));
    const namedChildren = new Map(children.filter(child => child.name).map(child => [child.name, child]));
    const unnamedTypes = new Map();
    for (const child of children) if (!child.name) unnamedTypes.set(child.type, (unnamedTypes.get(child.type) ?? 0) + 1);
    for (let index = 0; index < node.children.length; index++) {
      const child = sourceNodes.get(node.children[index]);
      if (!child.properties.Name && unnamedTypes.get(expectedType(child)) > 1) {
        reject('unnamed sibling controls have an ambiguous type; give them unique Name values', child.id);
      }
      pending.push([child, child.properties.Name ? namedChildren.get(child.properties.Name) : children[index]]);
    }
  }
  return bindings;
}

/**
 * Bind one exact owned source tree to live identities in O(source nodes + scene nodes).
 * Named children use unique names within their owner; unnamed children retain their ordinal.
 * The source baseline supplies authoring values, preserving unrelated runtime input. Pending
 * source edits retain their IDs/history; mismatches throw SFDL0009 without changing either input.
 */
export function bindLinkedLiveDesign(sourceDocument, runtimeDocument, {scene, baseline = sourceDocument} = {}) {
  const document = validateDesign(sourceDocument);
  const boundBaseline = validateDesign(baseline);
  const runtime = validateDesign(runtimeDocument);
  if (document.root !== boundBaseline.root) reject('the pending design replaces the source root', document.root);
  const bindings = mapOwnedTree(boundBaseline, runtime, scene);
  const baselineNodes = new Map(boundBaseline.nodes.map(node => [node.id, node]));
  for (const node of boundBaseline.nodes) node.runtimeId = bindings.get(node.id);
  for (const node of document.nodes) {
    const previous = baselineNodes.get(node.id);
    if (previous && (previous.type !== node.type || previous.projectType !== node.projectType)) {
      reject('a pending edit changes an existing control type', node.id);
    }
    delete node.runtimeId;
    if (bindings.has(node.id)) node.runtimeId = bindings.get(node.id);
  }
  return {document, baseline: boundBaseline, bindings: Object.fromEntries(bindings)};
}

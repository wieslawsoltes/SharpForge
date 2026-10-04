import {authoringError, boundedArray} from './property-diagnostics.js';

/** Pure transaction hook for deletion/ungroup: template part names are a separate scope and are never pruned as document IDs. */
export function pruneDesignerAuthoring(design, removedIds) {
  const removed = new Set(removedIds);
  for (const id of removed) if (design.designTime?.nodes) delete design.designTime.nodes[id];
  for (const node of design.nodes) {
    for (const group of node.states ?? []) {
      for (const state of group.states) state.setters = state.setters.filter(setter => !removed.has(setter.target));
    }
  }
  for (const state of design.responsive?.states ?? []) {
    for (const id of removed) delete state.overrides[id];
  }
  return design;
}

/** Remaps metadata in an isolated copied fragment; node IDs/children have already been remapped by the tree owner. */
export function remapDesignerAuthoringNodeIds(fragment, mapping) {
  const ids = mapping instanceof Map ? mapping : new Map(Object.entries(mapping));
  for (const node of fragment.nodes) {
    for (const group of node.states ?? []) {
      for (const state of group.states) for (const setter of state.setters) setter.target = ids.get(setter.target) ?? setter.target;
    }
  }
  if (fragment.designTime) {
    fragment.designTime.nodes = Object.fromEntries(Object.entries(fragment.designTime.nodes)
      .map(([id, data]) => [ids.get(id) ?? id, data]));
  }
  for (const state of fragment.responsive?.states ?? []) {
    state.overrides = Object.fromEntries(Object.entries(state.overrides).map(([id, properties]) => [ids.get(id) ?? id, properties]));
  }
  return fragment;
}

function copyAdaptiveStates(source, destination, ids) {
  const relevant = [];
  for (const state of source.responsive?.states ?? []) {
    const overrides = Object.fromEntries(Object.entries(state.overrides).filter(([id]) => ids.has(id))
      .map(([id, properties]) => [ids.get(id), structuredClone(properties)]));
    if (Object.keys(overrides).length) relevant.push({...state, overrides});
  }
  if (!relevant.length) return;
  destination.responsive ??= {version: 1, states: []};
  const states = new Map(destination.responsive.states.map(state => [state.id, state]));
  for (const state of relevant) {
    const existing = states.get(state.id);
    if (existing && existing.minWidth === state.minWidth && (existing.maxWidth ?? null) === (state.maxWidth ?? null)) {
      Object.assign(existing.overrides, state.overrides);
      continue;
    }
    if (destination.responsive.states.length >= 64) authoringError('SFD1851', 'Pasted adaptive state limit.');
    const originalId = state.id;
    let serial = 1;
    while (states.has(state.id)) state.id = originalId.slice(0, 50) + '_copy' + serial++;
    destination.responsive.states.push(state);
    states.set(state.id, state);
  }
}

/** Call once after cloning a subtree with the complete old→new ID map. Existing destination nodes retain their references. */
export function copyDesignerAuthoringNodeMetadata(source, destination, mapping) {
  const ids = mapping instanceof Map ? mapping : new Map(Object.entries(mapping));
  if (ids.size > 5000) authoringError('SFD1851', 'Clipboard node mapping limit.');
  const targets = new Set(ids.values());
  if (targets.size !== ids.size) authoringError('SFD1851', 'Copied node identities must remain unique.');
  const originals = new Map(source.nodes.map(node => [node.id, node]));
  const copies = new Map(destination.nodes.filter(node => targets.has(node.id)).map(node => [node.id, node]));
  const names = new Map();
  for (const [before, after] of ids) {
    if (!originals.has(before) || !copies.has(after)) authoringError('SFD1851', 'Clipboard metadata target was not found.');
    const oldName = originals.get(before).properties.Name;
    const newName = copies.get(after).properties.Name;
    if (oldName && newName) names.set(oldName, newName);
  }
  remapDesignerAuthoringNodeIds({nodes: [...copies.values()]}, ids);
  for (const node of copies.values()) {
    for (const binding of Object.values(node.bindings ?? {})) {
      if (names.has(binding.elementName)) binding.elementName = names.get(binding.elementName);
    }
  }
  for (const [before, after] of ids) {
    const data = source.designTime?.nodes[before];
    if (!data) continue;
    destination.designTime ??= {version: 1, nodes: {}};
    destination.designTime.nodes[after] = structuredClone(data);
  }
  boundedArray(destination.responsive?.states ?? [], 64, 'Adaptive states');
  copyAdaptiveStates(source, destination, ids);
  return destination;
}

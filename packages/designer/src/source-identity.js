import {sameSourceValue} from './source-text.js';

function fingerprint(node) {
  const properties = {...node.properties};
  delete properties.Name;
  return JSON.stringify([node.type, properties, node.style, node.template, Object.keys(node.events)]);
}

/** Remaps symbols first, then unique structural fingerprints; ambiguous matches never silently select a control. */
export function retainSourceIdentities(reader, previous, hints = {}) {
  const before = previous?.document ?? previous;
  if (!before?.nodes) return {};
  const oldBindings = previous?.bindings ?? {};
  const symbols = new Map(Object.values(oldBindings).filter(binding => binding.symbolKey).map(binding => [binding.symbolKey, binding]));
  const oldNodes = new Map(before.nodes.map(node => [node.id, node]));
  const claimed = new Set();
  const remap = {};
  const pending = [];
  for (const node of reader.nodes) {
    const binding = reader.bindings[node.id];
    const hinted = hints[binding.name];
    const exact = symbols.get(binding.symbolKey);
    const id = hinted ?? exact?.id ?? (oldNodes.has(node.id) && oldNodes.get(node.id).type === node.type ? node.id : null);
    if (id && !claimed.has(id)) {
      remap[node.id] = id;
      claimed.add(id);
    } else pending.push(node);
  }
  const unmatched = before.nodes.filter(node => !claimed.has(node.id));
  const fingerprints = new Map();
  for (const node of unmatched) {
    const key = fingerprint(node);
    if (!fingerprints.has(key)) fingerprints.set(key, []);
    fingerprints.get(key).push(node);
  }
  for (const node of pending) {
    const candidates = fingerprints.get(fingerprint(node))?.filter(old => !claimed.has(old.id)) ?? [];
    if (candidates.length === 1) {
      remap[node.id] = candidates[0].id;
      claimed.add(candidates[0].id);
    }
  }
  const remaining = pending.filter(node => !remap[node.id]);
  const prior = unmatched.filter(node => !claimed.has(node.id));
  if (remaining.length === prior.length && remaining.every((node, index) => node.type === prior[index].type)) {
    for (let index = 0; index < remaining.length; index++) {
      const node = remaining[index];
      const old = prior[index];
      if (sameSourceValue(node.children.length, old.children.length)) remap[node.id] = old.id;
    }
  }
  const bindings = {};
  reader.nodeMap.clear();
  for (const node of reader.nodes) {
    const binding = reader.bindings[node.id];
    node.id = remap[node.id] ?? node.id;
    node.children = node.children.map(id => remap[id] ?? id);
    binding.id = node.id;
    for (const edge of binding.edges) edge.child = remap[edge.child] ?? edge.child;
    bindings[node.id] = binding;
    reader.nodeMap.set(node.id, node);
  }
  reader.bindings = bindings;
  reader.root = remap[reader.root] ?? reader.root;
  for (const region of reader.regions) {
    region.owners = region.owners.map(id => remap[id] ?? id);
    for (const expression of region.expressions) expression.owner = remap[expression.owner] ?? expression.owner;
  }
  for (const warning of reader.warnings) if (warning.node) warning.node = remap[warning.node] ?? warning.node;
  return remap;
}

import {buildSolutionTree} from '../../packages/project-system/src/index.js';
import {prepareExplorerIdentities, publishExplorerIdentities} from './solution-explorer-identities.js';

// Text, versions, tabs and dirty flags do not change the display hierarchy. Project
// snapshots remain value-compared because membership can be updated in place.
function structureKey(data, {showAll, view}) {
  return JSON.stringify({
    identity: data.identity ?? data.name,
    name: data.name,
    files: (data.files ?? []).map(file => [file.path ?? file.uri, file.kind]),
    snapshot: data.snapshot ?? null,
    startup: data.startup,
    folders: data.folders ?? [],
    generated: (data.generated ?? []).map(file => file.uri),
    showAll, view
  });
}

function captureSymbol(symbol) {
  return {
    id: symbol.id, uri: symbol.uri, name: symbol.name, kind: symbol.kind,
    owner: symbol.owner, type: symbol.type,
    parameters: (symbol.parameters ?? []).map(parameter => parameter.type),
    start: symbol.start, end: symbol.end, source: symbol, nodes: []
  };
}

function sameSymbol(entry, symbol) {
  if (!entry || entry.uri !== symbol.uri || entry.name !== symbol.name
      || entry.kind !== symbol.kind || entry.owner !== symbol.owner || entry.type !== symbol.type
      || entry.parameters.length !== (symbol.parameters?.length ?? 0)) return false;
  for (let index = 0; index < entry.parameters.length; index++) {
    if (entry.parameters[index] !== symbol.parameters[index].type) return false;
  }
  return true;
}

function scopedRoots(roots, scope) {
  if (!scope) return {roots, scope: null};
  const pending = [...roots];
  while (pending.length) {
    const node = pending.pop();
    if (node.id === scope) return {roots: [node], scope};
    for (const child of node.children ?? []) pending.push(child);
  }
  return {roots, scope: null};
}

/**
 * Owns one explorer projection; TreeView still owns virtualization. Reuse keeps a
 * linear comparison of symbol display fields, but avoids sorting, cloning and
 * reindexing the full hierarchy for every source text or dirty-state update.
 */
export class SolutionExplorerProjection {
  constructor(model, {buildTree = buildSolutionTree} = {}) {
    this.model = model;
    this.buildTree = buildTree;
    this.reset();
  }

  reset() {
    this.key = null;
    this.scope = null;
    this.symbols = [];
    this.dirtyNodes = new Map();
    this.roots = null;
    this.nodes = null;
  }

  update(data, {showAll = false, view = 'solution', scope = null, force = false} = {}) {
    const key = structureKey(data, {showAll, view});
    const symbols = data.symbols ?? [];
    const reusable = !force && key === this.key && scope === this.scope
      && this.roots === this.model.roots && this.nodes === this.model.nodes;
    const updates = reusable ? this.symbolUpdates(symbols) : null;
    if (updates === null) return this.rebuild(data, {key, showAll, view, scope});
    const dirty = new Set(data.dirty ?? []);
    const identities = prepareExplorerIdentities(this.model, updates);
    publishExplorerIdentities(this.model, identities);
    this.applySymbolUpdates(updates);
    const dirtyChanged = this.updateDirty(dirty);
    this.scope = identities?.renames.get(this.scope) ?? this.scope;
    this.nodes = this.model.nodes;
    if (identities || dirtyChanged) this.model.notify();
    return {scope: this.scope, rebuilt: false, dirtyChanged, identityChanged: !!identities};
  }

  symbolUpdates(symbols) {
    if (symbols.length !== this.symbols.length) return null;
    const updates = [];
    for (let index = 0; index < symbols.length; index++) {
      const entry = this.symbols[index], symbol = symbols[index];
      if (!sameSymbol(entry, symbol)) return null;
      const id = symbol.id, start = symbol.start, end = symbol.end;
      if (entry.source !== symbol || entry.id !== id || entry.start !== start || entry.end !== end) {
        updates.push({entry, symbol, id, start, end});
      }
    }
    return updates;
  }

  rebuild(data, {key, showAll, view, scope}) {
    const symbols = (data.symbols ?? []).map(captureSymbol);
    const projection = scopedRoots(this.buildTree({...data, showAll, view}), scope);
    // TreeModel validates the complete candidate before publishing it. Do not
    // advance the cache or refresh old symbol aliases until that succeeds.
    this.model.setNodes(projection.roots);
    const entries = new Map(symbols.map(entry => [entry.source, entry]));
    const dirtyNodes = new Map();
    for (const node of this.model.nodes.values()) {
      const entry = entries.get(node.symbol);
      if (entry) entry.nodes.push({node, prefix: node.id.slice(0, node.id.length - String(entry.id).length)});
      if (!Object.hasOwn(node, 'dirty')) continue;
      const appearances = dirtyNodes.get(node.path) ?? [];
      appearances.push(node);
      dirtyNodes.set(node.path, appearances);
    }
    Object.assign(this, {key, scope: projection.scope, symbols, dirtyNodes,
      roots: this.model.roots, nodes: this.model.nodes});
    return {scope: this.scope, rebuilt: true, dirtyChanged: false};
  }

  applySymbolUpdates(updates) {
    for (const {entry, symbol, id, start, end} of updates) {
      for (const {node} of entry.nodes) {
        node.start = start;
        node.end = end;
        node.symbol = symbol;
      }
      entry.source = symbol;
      entry.id = id;
      entry.start = start;
      entry.end = end;
    }
  }

  updateDirty(dirty) {
    let changed = false;
    for (const [path, nodes] of this.dirtyNodes) {
      const value = dirty.has(path);
      for (const node of nodes) {
        if (node.dirty === value) continue;
        node.dirty = value;
        changed = true;
      }
    }
    return changed;
  }
}

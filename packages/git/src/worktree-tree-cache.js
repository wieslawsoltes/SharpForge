import { checkLimit } from './errors.js';
import { TreeView } from './tree-view.js';

/** Retain one immutable flattened tree, with isolated results for callers that edit maps or entries. */
export class WorktreeTreeCache {
  constructor() { this.clear(); }

  clear() {
    this.odb = null;
    this.oid = null;
    this.tree = null;
    this.visited = 0;
    this.view = null;
  }

  get(odb, oid, maxEntries, view = false) {
    if (this.odb !== odb || this.oid !== oid) return null;
    checkLimit(this.visited, maxEntries, 'Tree entries');
    if (view) return this.view;
    return new Map([...this.tree].map(([path, entry]) => [path, { ...entry }]));
  }

  set(odb, oid, tree, visited, { takeOwnership = false } = {}) {
    this.odb = odb;
    this.oid = oid;
    // Status owns its newly flattened map; public reads must retain a separate mutable result.
    this.tree = takeOwnership ? tree : new Map();
    for (const [path, entry] of tree) {
      if (takeOwnership) Object.freeze(entry);
      else this.tree.set(path, Object.freeze({ ...entry }));
    }
    this.visited = visited;
    this.view = new TreeView(this.tree);
    return this.view;
  }
}

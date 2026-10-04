import {TreeModel} from '@sharpforge/controls';
import {resolveLazyExplorerPath} from '@sharpforge/project-system';
import {stageChildPages} from './child-page.js';

function mappedPath(path, groups) {
  for (const mappings of groups) {
    const match = mappings.find(value => path === value.from || path.startsWith(value.from + '/'));
    if (match) path = match.to + path.slice(match.from.length);
  }
  return path;
}

function physicalPath(id, nodes) {
  const node = nodes.get(id);
  if (node?.kind === 'workspace') return '';
  if (typeof node?.path === 'string') return node.path;
  if (id.startsWith('file:')) return id.slice(5);
  if (id.startsWith('folder:')) return id.slice(7);
  return null;
}

/** Capture primitives before deferred indexing; render retries retain this original selection until admission completes. */
export function beginLazyExplorerRestore(explorer, options) {
  const data = explorer.getData();
  const plan = {...options, model: explorer.lazyTree.model, revision: explorer.model.revision,
    identity: data.identity, disk: data.disk, sourceRevision: data.revision, scrollPosition: explorer.tree.scrollTop};
  explorer.lazyStateRestore = plan;
  return plan;
}

function isCurrent(explorer, plan) {
  const data = explorer.getData();
  return !explorer.abort.signal.aborted && explorer.lazyStateRestore === plan && explorer.lazyTree?.model === plan.model
    && explorer.model.revision === plan.revision && explorer.scope === plan.scope && data.identity === plan.identity
    && data.disk === plan.disk && data.revision === plan.sourceRevision && explorer.tree.scrollTop === plan.scrollPosition;
}

function stateIds(plan, limit) {
  const state = plan.snapshot;
  if (state?.version !== 1 || !Array.isArray(state.selected) || !Array.isArray(state.expanded)) {
    throw new TypeError('Invalid lazy Explorer state');
  }
  const ids = new Set([plan.scope, state.focused, state.anchor, ...state.selected, ...state.expanded].filter(Boolean));
  if (ids.size > limit || [...ids].some(id => typeof id !== 'string' || id.length > 8192)) {
    throw new RangeError('Lazy Explorer state exceeds the tree identity budget');
  }
  return ids;
}

function addPages(pages, incoming, identities, limit) {
  for (const value of incoming) {
    const key = JSON.stringify([value.parentId, value.page.offset]);
    if (pages.has(key)) continue;
    for (const node of value.page.nodes) identities.add(node.id);
    if (identities.size > limit) throw new RangeError('Lazy Explorer restoration exceeds the tree node budget');
    pages.set(key, value);
  }
}

async function collectPages(explorer, plan, ids) {
  const tree = plan.model;
  const pages = new Map();
  const identities = new Set([tree.root.id]);
  const remapped = new Map();
  const resolvedPaths = new Map();
  const expanded = new Set(plan.snapshot.expanded);
  let yieldedAt = performance.now();
  for (const id of ids) {
    if (!isCurrent(explorer, plan)) return null;
    const original = id === tree.root.id ? '' : physicalPath(id, plan.nodes);
    if (original === null || original.includes('://')) continue;
    const path = mappedPath(original, plan.mappingGroups ?? []);
    let resolved = resolvedPaths.get(path);
    if (!resolvedPaths.has(path)) {
      resolved = path ? await resolveLazyExplorerPath(tree, path, {signal: explorer.abort.signal}) : {path: '', pages: []};
      resolvedPaths.set(path, resolved);
    }
    if (!isCurrent(explorer, plan)) return null;
    if (!resolved) continue;
    const last = resolved.pages.at(-1);
    const target = last ? last.page.nodes.find(node => node.path === resolved.path) : tree.root;
    if (!target) throw new Error('Resolved Explorer page lacks its target');
    remapped.set(id, target.id);
    addPages(pages, resolved.pages, identities, explorer.model.maxNodes);
    if (expanded.has(id) && target.loadChildren) {
      const page = await tree.loadChildren(resolved.path, {offset: 0, limit: tree.pageSize, signal: explorer.abort.signal});
      if (!isCurrent(explorer, plan)) return null;
      addPages(pages, [{parentId: target.id, page}], identities, explorer.model.maxNodes);
    }
    if (performance.now() - yieldedAt >= 8) {
      await new Promise(resolve => setTimeout(resolve, 0));
      yieldedAt = performance.now();
    }
  }
  return {pages: [...pages.values()], remapped};
}

function restoredSnapshot(snapshot, remapped, nodes) {
  const id = value => remapped.get(value) ?? (nodes.has(value) ? value : null);
  return {version: 1, expanded: snapshot.expanded.map(id).filter(Boolean), selected: snapshot.selected.map(id).filter(Boolean),
    focused: id(snapshot.focused), anchor: id(snapshot.anchor)};
}

/** Restore only saved ancestor/child pages, never file bytes; stale work cannot replace a newer user selection or workspace. */
export async function restoreLazyExplorerState(explorer, plan) {
  let published = false;
  try {
    if (!isCurrent(explorer, plan)) return false;
    const ids = stateIds(plan, explorer.model.maxNodes);
    const result = await collectPages(explorer, plan, ids);
    if (!result || !isCurrent(explorer, plan)) return false;
    const staged = new TreeModel(explorer.lazyTree.roots, {maxNodes: explorer.model.maxNodes, maxDepth: explorer.model.maxDepth});
    staged.setNodes(stageChildPages(staged, result.pages));
    const scope = result.remapped.get(plan.scope) ?? (staged.nodes.has(plan.scope) ? plan.scope : null);
    const roots = scope ? [staged.nodes.get(scope)] : staged.roots;
    const state = restoredSnapshot(plan.snapshot, result.remapped, staged.nodes);
    // Validate the scoped shape before publishing either the full cache or the visible model.
    new TreeModel(roots, {maxNodes: explorer.model.maxNodes, maxDepth: explorer.model.maxDepth});
    if (!isCurrent(explorer, plan)) return false;
    published = true;
    explorer.restoring = true;
    try {
      explorer.lazyTree.roots = staged.roots;
      explorer.scope = scope;
      explorer.model.setNodes(roots);
      explorer.model.setFilter(plan.query);
      explorer.model.restore(state);
      explorer.tree.scrollTop = plan.scrollTop;
    } finally { explorer.restoring = false; }
    explorer.lazyStateRestore = null;
    explorer.onProperties?.(explorer.selected());
    explorer.updateCaption();
    explorer.saveState();
    if (plan.mappingGroups?.some(group => group.length)) explorer.control.ensureVisible();
    return true;
  } catch (error) {
    if (published || isCurrent(explorer, plan)) throw error;
    return false;
  } finally {
    if (explorer.lazyStateRestore === plan) explorer.lazyStateRestore = null;
  }
}

/** Keep the complete admitted hierarchy while the visible control contains only one scoped subtree. */
export function cacheLazyExplorerRoots(explorer) {
  if (!explorer.lazyTree) return;
  if (!explorer.scope || explorer.model.roots[0]?.id === explorer.lazyTree.model.root.id) {
    explorer.lazyTree.roots = explorer.model.roots;
    return;
  }
  const replacement = explorer.model.roots[0];
  const replace = node => node.id === replacement.id ? replacement : {...node, children: node.children.map(replace)};
  const roots = explorer.lazyTree.roots.map(replace);
  const validated = new TreeModel(roots, {maxNodes: explorer.model.maxNodes, maxDepth: explorer.model.maxDepth});
  explorer.lazyTree.roots = validated.roots;
}

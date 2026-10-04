import {resolveLazyExplorerPath} from '@sharpforge/project-system';

function materializedNode(model, path) {
  const direct = model.nodes.get('file:' + path);
  if (direct?.path === path) return direct;
  const nodes = [...model.nodes.values()];
  return nodes.find(node => node.path === path && node.kind === 'source') ?? nodes.find(node => node.path === path && !node.branch);
}

/** Reveal a current path, admitting only its ancestor pages when folder virtualization has not materialized it yet. */
export async function revealExplorerPath(explorer, path, focus = false) {
  const sequence = explorer.revealSequence = (explorer.revealSequence ?? 0) + 1;
  let node = materializedNode(explorer.model, path);
  if (!node) {
    const tree = explorer.lazyTree?.model;
    if (!tree || !path || path.includes('://')) return false;
    const {identity, disk, revision} = explorer.getData();
    const scope = explorer.scope;
    const current = () => !explorer.abort.signal.aborted && explorer.revealSequence === sequence
      && explorer.lazyTree?.model === tree && explorer.scope === scope && explorer.getData().identity === identity
      && explorer.getData().disk === disk && explorer.getData().revision === revision;
    let resolved;
    try { resolved = await resolveLazyExplorerPath(tree, path, {signal: explorer.abort.signal}); }
    catch (error) { if (current()) throw error; return false; }
    if (!resolved || !current()) return false;
    explorer.childLoader.admitPages(resolved.pages);
    node = materializedNode(explorer.model, resolved.path);
  }
  if (!node || explorer.abort.signal.aborted) return false;
  if (explorer.model.query) { explorer.search.value = ''; explorer.model.setFilter(''); }
  explorer.model.reveal(node.id);
  explorer.onProperties?.([node]);
  explorer.control.ensureVisible();
  if (focus) explorer.tree.focus();
  return true;
}

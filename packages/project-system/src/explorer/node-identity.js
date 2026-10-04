/** Node identities use owned paths/symbol identities, never presentation order or a nesting parent. */
export function explorerNodeId(kind, owner, identity = '') {
  if (![kind, owner, identity].every(value => typeof value === 'string')) throw new TypeError('Explorer identities must be strings');
  if (!kind || kind.length + owner.length + identity.length > 8000) throw new RangeError('Explorer identity limit exceeded');
  return kind === 'project' ? 'project:' + owner : owner + ':' + kind + ':' + identity;
}

/** Remap UI state using physical paths after a transaction; unrelated dependencies retain their original identity. */
export function remapExplorerState(state, oldNodes, newNodes, mappings = []) {
  const lookup = new Map();
  for (const node of newNodes.values()) {
    const key = JSON.stringify([node.kind, node.path, node.project ?? '', node.symbol?.id ?? '']);
    if (!lookup.has(key)) lookup.set(key, node.id);
  }
  const mapped = path => {
    if (!path) return path;
    const match = mappings.find(value => path === value.from || path.startsWith(value.from + '/'));
    return match ? match.to + path.slice(match.from.length) : path;
  };
  const remap = id => {
    if (newNodes.has(id)) return id;
    const node = oldNodes.get(id);
    if (!node) return null;
    return lookup.get(JSON.stringify([node.kind, mapped(node.path), mapped(node.project ?? ''), node.symbol?.id ?? ''])) ?? null;
  };
  return {version: 1, expanded: state.expanded.map(remap).filter(Boolean), selected: state.selected.map(remap).filter(Boolean),
    focused: remap(state.focused), anchor: remap(state.anchor)};
}

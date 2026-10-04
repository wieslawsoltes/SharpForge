function available(tree, signal) {
  if (signal?.aborted || tree.disposed) throw new DOMException('Explorer reveal cancelled', 'AbortError');
}

function entryIndex(ordered, target) {
  // The directory index orders folders first, then its normalized path keys. Search without admitting sibling nodes.
  let low = 0;
  let high = ordered.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const entry = ordered[middle];
    const before = entry.type === target.type ? entry.orderKey < target.orderKey : entry.type === 'directory';
    if (before) low = middle + 1;
    else high = middle;
  }
  if (ordered[low] !== target) throw new Error('Explorer directory ordering does not contain its indexed path');
  return low;
}

/** Resolve a physical path to one containing page per ancestor. Missing paths return null; cancellation rejects before admission.
 * Node allocation is O(depth × page size), with O(log siblings) lookup after the shared directory index is prepared.
 */
export async function resolveLazyExplorerPath(tree, path, {signal} = {}) {
  available(tree, signal);
  const parts = tree.policy.normalize(path).split('/');
  await tree.prepare(signal);
  available(tree, signal);
  let parentPath = '';
  const pages = [];
  for (let depth = 0; depth < parts.length; depth++) {
    const directory = tree.directories.get(parentPath);
    const target = directory?.children.get(tree.identity(parts[depth]));
    if (!target || (depth < parts.length - 1 && target.type !== 'directory')) return null;
    if (!directory.ordered) await tree.loadChildren(parentPath, {limit: 1, signal});
    available(tree, signal);
    const offset = Math.floor(entryIndex(directory.ordered, target) / tree.pageSize) * tree.pageSize;
    const page = await tree.loadChildren(parentPath, {offset, limit: tree.pageSize, signal});
    available(tree, signal);
    pages.push({parentId: parentPath ? 'folder:' + parentPath : tree.root.id, page});
    parentPath = target.path;
  }
  return {path: parentPath, pages};
}

/** Child pages are staged before tree publication, including direct reveals of noncontiguous pages. */
export function childPage(value) {
  if (Array.isArray(value)) return {nodes: value, offset: 0, total: value.length, hasMore: false, complete: true};
  if (!value || !Array.isArray(value.nodes) || !Number.isSafeInteger(value.offset) || value.offset < 0) {
    throw new TypeError('Explorer child page requires nodes and a nonnegative safe offset');
  }
  const end = value.offset + value.nodes.length;
  if (!Number.isSafeInteger(end) || (value.hasMore && !value.nodes.length)) throw new RangeError('Explorer page does not advance');
  if (value.total !== undefined && (!Number.isSafeInteger(value.total) || value.total < end
    || !!value.hasMore !== (end < value.total))) throw new RangeError('Explorer page total is inconsistent');
  return value;
}

function moreNode(parent, offset) {
  return {id: parent.id + ':more:' + offset, kind: 'load-more', label: 'Load more…', icon: '…', draggable: false,
    parentId: parent.id, offset};
}

export function mergeChildPage(parent, value) {
  const page = childPage(value);
  if (page.complete) return {...parent, children: page.nodes, childTotal: page.total, childCount: page.total};
  const indices = new Map();
  const identities = new Map();
  for (const child of parent.children ?? []) {
    if (child.kind === 'load-more') continue;
    if (!Number.isSafeInteger(child.pageIndex)) throw new Error('Explorer child lacks a stable page position');
    indices.set(child.pageIndex, child);
    identities.set(child.id, child.pageIndex);
  }
  const incoming = new Set();
  for (let index = 0; index < page.nodes.length; index++) {
    const child = page.nodes[index];
    const position = page.offset + index;
    if (!child || incoming.has(child.id) || (identities.has(child.id) && identities.get(child.id) !== position)) {
      throw new Error('Explorer page IDs must be unique at their admitted positions');
    }
    incoming.add(child.id);
    const existing = indices.get(position);
    if (existing && existing.id !== child.id) throw new Error('Explorer page changed an admitted position');
    // Preserve already-expanded children and loader identities when a reveal overlaps ordinary pagination.
    indices.set(position, existing ?? {...child, pageIndex: position});
  }
  const children = [...indices.values()].sort((left, right) => left.pageIndex - right.pageIndex);
  const end = page.offset + page.nodes.length;
  const total = page.total ?? (page.hasMore ? parent.childTotal : end);
  if (parent.childTotal !== undefined && total !== undefined && parent.childTotal !== total) {
    throw new Error('Explorer page changed its directory total');
  }
  if (total !== undefined && children.some(child => child.pageIndex >= total)) throw new Error('Explorer page exceeds its directory total');
  let next = 0;
  for (const child of children) {
    if (child.pageIndex !== next) break;
    next++;
  }
  if (total === undefined || next < total) children.push(moreNode(parent, next));
  return {...parent, children, childTotal: total, childCount: total ?? parent.childCount};
}

export function stageChildPages(model, pages) {
  const indexed = new Map(model.nodes);
  const replacements = new Map();
  for (const {parentId, page} of pages) {
    const parent = indexed.get(parentId);
    if (!parent?.loadChildren) continue; // A scoped tree may begin partway through the physical ancestor chain.
    const next = {...mergeChildPage(parent, page), loaded: true, loading: false};
    replacements.set(parentId, next);
    indexed.set(parentId, next);
    for (const child of next.children) if (!indexed.has(child.id)) indexed.set(child.id, child);
  }
  let count = 0;
  const identities = new Set();
  const replace = (node, depth) => {
    if (identities.has(node.id)) throw new Error('Explorer tree IDs must be unique');
    identities.add(node.id);
    if (++count > model.maxNodes || depth > model.maxDepth) throw new RangeError('Tree size/depth limit exceeded');
    const next = replacements.get(node.id) ?? node;
    const children = (next.children ?? []).map(child => replace(child, depth + 1));
    return {...next, children};
  };
  return model.roots.map(root => replace(root, 1));
}

import { createGroup, createSplit, panelIds, walkLayout, restorePersistedLayout } from '@sharpforge/docking';

const clone = value => JSON.parse(JSON.stringify(value));

/** Applies saved tool positions while retaining every currently open document, its groups, views and pinned state. */
export function mergeToolLayout(layout, saved, { viewport } = {}) {
  const current = layout.snapshot();
  const restored = restorePersistedLayout(saved, layout.panels, { viewport });
  const next = restored.state;
  const isDocument = id => layout.panels.get(id)?.kind === 'document';
  function documents(node) {
    if (node.type === 'group') {
      const ids = node.panels.filter(isDocument);
      if (!ids.length) return null;
      return { ...clone(node), kind: 'document', panels: ids, active: ids.includes(node.active) ? node.active : ids[0] };
    }
    const first = documents(node.first);
    const second = documents(node.second);
    return first && second ? { ...clone(node), first, second } : first ?? second;
  }
  function tools(node) {
    if (node.type === 'group') {
      const ids = node.panels.filter(id => !isDocument(id));
      return { ...node, panels: ids, active: ids.includes(node.active) ? node.active : ids[0] ?? null };
    }
    return { ...node, first: tools(node.first), second: tools(node.second) };
  }
  next.root = tools(next.root);
  next.floating = next.floating.map(item => ({ ...item, root: tools(item.root) })).filter(item => panelIds(item.root).length);
  const documentRoot = documents(current.root);
  let grafted = false;
  function graft(node) {
    if (node.type === 'group') {
      if (node.kind === 'document' && !node.panels.length && !grafted && documentRoot) { grafted = true; return documentRoot; }
      return node;
    }
    node.first = graft(node.first);
    node.second = graft(node.second);
    return node;
  }
  next.root = graft(next.root);
  if (documentRoot && !grafted) next.root = createSplit('layout-document-well', 'horizontal', documentRoot, next.root, .75);
  if (!documentRoot && !findDocumentGroup(next.root)) {
    next.root = createSplit('layout-document-well', 'horizontal', createGroup('documents', [], 'document'), next.root, .75);
  }
  for (const floating of current.floating) {
    const root = documents(floating.root);
    if (root) next.floating.push({ ...floating, root });
  }
  const nodeIds = new Set();
  let serial = 0;
  function unique(node) {
    if (nodeIds.has(node.id)) node.id = `layout-node-${++serial}`;
    while (nodeIds.has(node.id)) node.id = `layout-node-${++serial}`;
    nodeIds.add(node.id);
  }
  walkLayout(next.root, unique);
  for (const floating of next.floating) {
    unique(floating);
    walkLayout(floating.root, unique);
  }
  const placed = new Set(panelIds(next.root));
  for (const floating of next.floating) for (const id of panelIds(floating.root)) placed.add(id);
  for (const ids of Object.values(next.autoHide)) for (const id of ids) placed.add(id);
  next.closed = [...layout.panels.keys()].filter(id => !placed.has(id));
  next.tabState = current.tabState;
  next.documentViews = current.documentViews;
  if (current.activePanel && isDocument(current.activePanel)) next.activePanel = current.activePanel;
  layout.validate(next);
  return { state: next, diagnostics: restored.diagnostics };
}

function findDocumentGroup(root) {
  let result = null;
  walkLayout(root, node => { if (node.type === 'group' && node.kind === 'document') result = node; });
  return result;
}

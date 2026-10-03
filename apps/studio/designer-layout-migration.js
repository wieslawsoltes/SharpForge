export const retiredDesignerPanelIds = Object.freeze(['designer', 'designer-source']);
const retired = new Set(retiredDesignerPanelIds);

/** Removes 0.14 standalone designer panels from a version-1 dock record while preserving all live document groups. */
export function migrateDesignerLayout(input, {knownPanels = null, activeUri = null} = {}) {
  const wasText = typeof input === 'string';
  const state = wasText ? JSON.parse(input) : structuredClone(input);
  if (state?.version !== 1 || !state.root || !Array.isArray(state.floating) || !Array.isArray(state.closed)) {
    throw new TypeError('A version-1 docking layout is required for designer migration');
  }
  const known = knownPanels ? new Set([...knownPanels].map(panel => typeof panel === 'string' ? panel : panel.id)) : null;
  const keep = id => !retired.has(id) && (!known || known.has(id));
  const placed = new Set();
  const documents = [];
  let count = 0;
  const filter = values => {
    if (!Array.isArray(values)) throw new TypeError('Invalid panel list in docking layout');
    return values.filter(id => {
      if (typeof id !== 'string' || !keep(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    });
  };
  const visit = (node, depth = 0) => {
    if (!node || depth > 32 || ++count > 512) throw new RangeError('Docking layout nesting or node limit exceeded');
    if (node.type === 'split') {
      visit(node.first, depth + 1);
      visit(node.second, depth + 1);
    } else if (node.type === 'group') {
      node.panels = filter(node.panels);
      if (!node.panels.includes(node.active)) node.active = node.panels[0] ?? null;
      if (node.kind === 'document') documents.push(...node.panels);
    } else throw new TypeError('Unknown docking node kind');
  };
  visit(state.root);
  for (const floating of state.floating) visit(floating.root);
  for (const side of ['left', 'right', 'top', 'bottom']) {
    if (!state.autoHide) throw new TypeError('Missing auto-hide shelves in docking layout');
    state.autoHide[side] = filter(state.autoHide[side]);
  }
  state.closed = filter(state.closed);
  if (known) for (const id of known) if (keep(id) && !placed.has(id)) state.closed.push(id);
  if (!keep(state.activePanel) || !placed.has(state.activePanel)) {
    const preferred = activeUri ? `source:${activeUri}` : null;
    state.activePanel = preferred && documents.includes(preferred) ? preferred : documents[0] ?? null;
  }
  return wasText ? JSON.stringify(state) : state;
}

/** Standalone designer JSON is a document kind, never a tool-window identity. */
export function designerDocumentKind(uri) {
  return typeof uri === 'string' && /\.sfdesign\.json$/i.test(uri) ? 'design' : null;
}

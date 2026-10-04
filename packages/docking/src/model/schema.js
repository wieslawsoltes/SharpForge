import { cloneLayout, createGroup, DOCK_SIDES, panelIds } from './nodes.js';

export const DOCK_LAYOUT_VERSION = 2;
export const DOCK_LAYOUT_LIMITS = Object.freeze({ bytes: 2_000_000, nodes: 512, depth: 32, floating: 64, panels: 8192 });

export function emptyLayout(ids = []) {
  return {
    version: DOCK_LAYOUT_VERSION,
    root: createGroup('documents', [], 'document'),
    floating: [],
    autoHide: { left: [], right: [], top: [], bottom: [] },
    closed: [...ids],
    activePanel: null,
    returnLocations: {},
    tabState: {},
    flyoutSizes: {}
  };
}

/** Version 1 migration is lossless. Unknown future versions are rejected. */
export function migrateLayout(value) {
  if (typeof value === 'string' && value.length > DOCK_LAYOUT_LIMITS.bytes) throw new Error('Dock layout exceeds the size limit');
  const state = typeof value === 'string' ? JSON.parse(value) : cloneLayout(value);
  if (state?.version === 1) {
    state.version = DOCK_LAYOUT_VERSION;
    state.returnLocations = {};
    state.tabState = {};
    state.flyoutSizes = {};
  }
  if (state?.version !== DOCK_LAYOUT_VERSION) throw new Error('Unsupported docking layout version');
  return state;
}

export function validateLayout(state, panels) {
  if (state?.version !== DOCK_LAYOUT_VERSION || !Array.isArray(state.floating)
      || state.floating.length > DOCK_LAYOUT_LIMITS.floating || !Array.isArray(state.closed)) {
    throw new Error('Invalid docking layout');
  }
  const nodes = new Set();
  const placed = new Set();
  let count = 0;
  function panel(id) {
    if (typeof id !== 'string' || !panels.has(id) || placed.has(id)) throw new Error(`Unknown or duplicate panel '${id}' in layout`);
    placed.add(id);
  }
  function node(item, depth = 0) {
    if (!item || depth > DOCK_LAYOUT_LIMITS.depth || ++count > DOCK_LAYOUT_LIMITS.nodes
        || typeof item.id !== 'string' || !item.id || item.id.length > 1024 || nodes.has(item.id)) {
      throw new Error('Invalid or duplicate docking node');
    }
    nodes.add(item.id);
    if (item.type === 'group') {
      if (!['tool', 'document'].includes(item.kind) || !Array.isArray(item.panels)) throw new Error('Invalid docking group');
      item.panels.forEach(panel);
      if (item.active !== null && !item.panels.includes(item.active)) throw new Error('Active panel is not in its group');
      if (item.panels.length && !item.active) throw new Error('Nonempty group needs an active panel');
    } else if (item.type === 'split') {
      if (!['horizontal', 'vertical'].includes(item.axis) || !Number.isFinite(item.ratio) || item.ratio < .05 || item.ratio > .95) {
        throw new Error('Invalid split ratio');
      }
      node(item.first, depth + 1);
      node(item.second, depth + 1);
    } else throw new Error('Unknown docking node type');
  }
  node(state.root);
  for (const floating of state.floating) {
    if (typeof floating.id !== 'string' || !floating.id || nodes.has(floating.id)) throw new Error('Invalid floating identifier');
    nodes.add(floating.id);
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(floating[key])) throw new Error('Invalid floating bounds');
    }
    if (floating.width < 160 || floating.height < 100 || Math.abs(floating.x) > 100000 || Math.abs(floating.y) > 100000
        || floating.width > 20000 || floating.height > 20000) throw new Error('Floating bounds outside limits');
    node(floating.root);
  }
  for (const side of DOCK_SIDES) {
    if (!Array.isArray(state.autoHide?.[side])) throw new Error('Invalid auto-hide shelf');
    state.autoHide[side].forEach(panel);
    for (const id of state.autoHide[side]) if (panels.get(id).kind === 'document') throw new Error('Documents cannot auto-hide');
  }
  state.closed.forEach(panel);
  if (placed.size !== panels.size) throw new Error('Layout must place or close every registered panel');
  if (state.activePanel !== null && !panels.has(state.activePanel)) throw new Error('Invalid active panel');
  for (const key of ['returnLocations', 'tabState', 'flyoutSizes']) {
    if (!state[key] || Array.isArray(state[key]) || typeof state[key] !== 'object') throw new Error(`Invalid layout ${key}`);
  }
  for (const [id, item] of Object.entries(state.tabState)) {
    if (!panels.has(id) || !item || typeof item.pinned !== 'boolean' || typeof item.preview !== 'boolean'
        || item.pinned && item.preview) throw new Error('Invalid document tab state');
  }
  for (const size of Object.values(state.flyoutSizes)) {
    if (!Number.isFinite(size) || size < 100 || size > 20000) throw new Error('Invalid auto-hide flyout size');
  }
  return true;
}

/** Clamps bounds to a CSS-pixel work area, retaining an accessible title bar. */
export function clampFloatingBounds(bounds, viewport = {}) {
  const availableWidth = Math.max(160, Number(viewport.width) || 1920);
  const availableHeight = Math.max(100, Number(viewport.height) || 1080);
  const width = Math.max(160, Math.min(Number(bounds.width) || 640, availableWidth));
  const height = Math.max(100, Math.min(Number(bounds.height) || 400, availableHeight));
  return {
    x: Math.max(0, Math.min(Number(bounds.x) || 0, availableWidth - width)),
    y: Math.max(0, Math.min(Number(bounds.y) || 0, availableHeight - Math.min(height, 40))),
    width,
    height
  };
}

/** Repairs persisted identities only, reporting every dropped identity. Structural corruption uses a valid empty layout. */
export function restorePersistedLayout(value, panels, { viewport, fallback } = {}) {
  const diagnostics = [];
  let state;
  try {
    state = migrateLayout(value);
    const seen = new Set();
    let count = 0;
    function keep(id) {
      if (!panels.has(id) || seen.has(id)) {
        diagnostics.push({ code: panels.has(id) ? 'SFDOCK002' : 'SFDOCK001', panelId: String(id), message: 'Dropped unavailable panel identity' });
        return false;
      }
      seen.add(id);
      return true;
    }
    function repair(node, depth = 0) {
      if (!node || depth > DOCK_LAYOUT_LIMITS.depth || ++count > DOCK_LAYOUT_LIMITS.nodes) throw new Error('Layout tree limit exceeded');
      if (node.type === 'group') {
        node.panels = node.panels.filter(keep);
        if (!node.panels.includes(node.active)) node.active = node.panels[0] ?? null;
        return node.panels.length || node.kind === 'document' ? node : null;
      }
      if (node.type !== 'split') throw new Error('Unknown docking node');
      node.first = repair(node.first, depth + 1);
      node.second = repair(node.second, depth + 1);
      return node.first && node.second ? node : node.first ?? node.second;
    }
    state.root = repair(state.root) ?? createGroup('documents-restored', [], 'document');
    state.floating = state.floating.map(item => ({ ...item, ...clampFloatingBounds(item, viewport), root: repair(item.root) }))
      .filter(item => item.root && panelIds(item.root).length);
    for (const side of DOCK_SIDES) state.autoHide[side] = state.autoHide[side].filter(keep);
    state.closed = state.closed.filter(keep);
    for (const id of panels.keys()) if (!seen.has(id)) state.closed.push(id);
    if (!panels.has(state.activePanel)) state.activePanel = null;
    for (const key of ['returnLocations', 'tabState', 'flyoutSizes']) {
      for (const id of Object.keys(state[key])) if (!panels.has(id)) delete state[key][id];
    }
    validateLayout(state, panels);
  } catch (error) {
    diagnostics.push({ code: 'SFDOCK003', message: `Reset corrupt layout: ${error.message}` });
    state = fallback ? migrateLayout(fallback) : emptyLayout(panels.keys());
    validateLayout(state, panels);
  }
  return { state, diagnostics };
}

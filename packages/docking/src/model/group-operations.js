import { capturePlacement, createGroup, createSplit, DOCK_SIDES, panelIds } from './nodes.js';

function extract(layout, id) {
  const floating = layout.state.floating.find(item => item.id === id || item.root.id === id);
  if (floating) {
    layout.state.floating = layout.state.floating.filter(item => item !== floating);
    return floating.root;
  }
  const source = layout.node(id);
  if (!source) throw new Error('Unknown docking subtree');
  if (source === layout.state.root) {
    layout.state.root = createGroup(layout.id('documents'), [], 'document');
    return source;
  }
  function remove(node) {
    if (node.type !== 'split') return node;
    if (node.first.id === id) return node.second;
    if (node.second.id === id) return node.first;
    node.first = remove(node.first);
    node.second = remove(node.second);
    return node;
  }
  layout.state.root = remove(layout.state.root);
  for (const item of layout.state.floating) item.root = remove(item.root);
  return source;
}

/** Floats an entire tab group or split subtree, preserving node and panel identities. */
export function floatNode(layout, nodeId, bounds) {
  const node = layout.node(nodeId);
  if (!node || !panelIds(node).length) throw new Error('Cannot float an empty or unknown group');
  return layout.change('floatGroup', () => {
    const ids = panelIds(node);
    const location = capturePlacement(layout, ids[0]);
    for (const id of ids) layout.state.returnLocations[id] = capturePlacement(layout, id);
    const root = extract(layout, nodeId);
    layout.state.floating.push({ id: layout.id('float'), x: 80, y: 70, width: 640, height: 400, ...bounds,
      returnLocation: location, root });
    layout.state.activePanel = root.active ?? ids[0];
  });
}

/** Re-docks a complete floating/group subtree in one transaction; center merges leaf tabs in traversal order. */
export function dockNode(layout, nodeId, targetId, side, { root = false } = {}) {
  if (!['center', ...DOCK_SIDES].includes(side) || root && side === 'center') throw new Error('Invalid group dock direction');
  const floating = layout.state.floating.find(item => item.id === nodeId);
  const source = floating?.root ?? layout.node(nodeId);
  const target = root ? layout.state.root : layout.group(targetId);
  if (!source || !target) throw new Error('Unknown docking subtree or target');
  if (source === target || panelIds(source).some(id => panelIds(target).includes(id))) throw new Error('Cannot dock a group into itself');
  return layout.change('dockGroup', () => {
    const moving = extract(layout, floating?.id ?? source.id);
    const ids = panelIds(moving);
    if (side === 'center') {
      target.panels.push(...ids);
      target.active = moving.active ?? ids[0] ?? target.active;
    } else {
      const first = side === 'left' || side === 'top';
      const split = createSplit(layout.id('split'), ['left', 'right'].includes(side) ? 'horizontal' : 'vertical',
        first ? moving : target, first ? target : moving, .5);
      if (root) layout.state.root = split;
      else layout.replaceNode(target.id, split);
    }
    layout.state.activePanel = ids.includes(layout.state.activePanel) ? layout.state.activePanel : ids[0];
  });
}

/** Restores an auto-hidden/closed/floating panel against its original identity anchors. */
export function restorePlacement(layout, id) {
  const location = layout.state.returnLocations[id];
  const existing = location?.groupId && layout.group(location.groupId);
  if (existing && !layout.locate(id).floatingId) return layout.dock(id, existing.id, 'center', location.index);
  // Original peers in the same floating group are not a valid docked return target.
  const originalGroup = existing && !layout.state.floating.some(item => panelIds(item.root).includes(existing.panels[0]));
  if (originalGroup) return layout.dock(id, existing.id, 'center', location.index);
  for (const anchor of location?.anchors ?? []) {
    for (const peerId of anchor.panels) {
      if (!layout.panels.has(peerId)) continue;
      const peer = layout.locate(peerId);
      if (!peer.group || peer.floatingId) continue;
      return layout.change('pin', () => {
        layout.dock(id, peer.group.id, anchor.side);
        const group = layout.locate(id).group;
        if (location.groupId && !layout.node(location.groupId)) group.id = location.groupId;
      });
    }
  }
  return layout.change('pin', () => {
    layout.dockRoot(id, location?.side ?? 'left');
    const group = layout.locate(id).group;
    if (location?.groupId && !layout.node(location.groupId)) group.id = location.groupId;
  });
}

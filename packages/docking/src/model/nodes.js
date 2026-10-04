export const DOCK_SIDES = Object.freeze(['left', 'right', 'top', 'bottom']);
export const cloneLayout = value => JSON.parse(JSON.stringify(value));

export function createGroup(id, panels = [], kind = 'tool') {
  return { type: 'group', id, kind, panels: [...panels], active: panels[0] ?? null };
}

export function createSplit(id, axis, first, second, ratio = .5) {
  return { type: 'split', id, axis, ratio, first, second };
}

/** Visits a validated tree in pre-order. Layout depth is bounded by schema validation. */
export function walkLayout(node, visit, parent = null) {
  if (!node) return;
  visit(node, parent);
  if (node.type === 'split') {
    walkLayout(node.first, visit, node);
    walkLayout(node.second, visit, node);
  }
}

export function panelIds(node) {
  const result = [];
  walkLayout(node, item => {
    if (item.type === 'group') result.push(...item.panels);
  });
  return result;
}

/** Captures identity-based anchors; a missing anchor is never replaced with an unrelated panel. */
export function capturePlacement(layout, id) {
  const where = layout.locate(id);
  if (!where.group) return layout.state.returnLocations[id] ?? { side: where.side ?? 'left' };
  const anchors = [];
  function find(node) {
    if (node.id === where.group.id) return true;
    if (node.type !== 'split') return false;
    for (const branch of ['first', 'second']) {
      if (!find(node[branch])) continue;
      const sibling = node[branch === 'first' ? 'second' : 'first'];
      const side = node.axis === 'horizontal' ? (branch === 'first' ? 'left' : 'right') : (branch === 'first' ? 'top' : 'bottom');
      anchors.push({ panels: panelIds(sibling), side, ratio: node.ratio });
      return true;
    }
    return false;
  }
  find(layout.state.root);
  return { groupId: where.group.id, kind: where.group.kind, index: where.index, anchors, side: anchors[0]?.side ?? 'left' };
}

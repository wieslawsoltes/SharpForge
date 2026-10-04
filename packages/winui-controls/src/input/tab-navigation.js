function enabled(node) {
  const properties = node?.properties ?? {};
  return properties.Visibility !== 1 && properties.IsEnabled !== false && properties.IsEnabled !== 0
    && properties.IsTabStop !== false && properties.IsTabStop !== 0 && (properties.TabIndex ?? 0) >= 0;
}

/** Stable tab order uses TabIndex followed by visual order; nested Once/Cycle scopes are explicit. */
export function tabOrder(nodes, roots, childrenOf, { current = null, isTabStop = () => false } = {}) {
  const ordered = [];
  const onceScopes = new Map();
  const visit = (id, ancestorsEnabled, onceScope = null) => {
    const node = nodes.get(id);
    if (!node) return;
    const properties = node.properties ?? {};
    const visible = ancestorsEnabled && properties.Visibility !== 1 && properties.Visible !== false
      && properties.IsEnabled !== false && properties.IsEnabled !== 0;
    if (!visible) return;
    const mode = properties.TabFocusNavigation;
    if (onceScope == null && (mode === 2 || mode === 'Once')) onceScope = id;
    if (enabled(node) && (properties.IsTabStop === true || properties.TabIndex !== undefined || isTabStop(id))) {
      ordered.push(id);
      if (onceScope != null) onceScopes.set(id, onceScope);
    }
    for (const child of childrenOf(id)) visit(child, visible, onceScope);
  };
  for (const root of roots) visit(root, true);
  const sorted = ordered.map((id, index) => ({ id, index, tab: nodes.get(id).properties?.TabIndex ?? 0 }))
    .sort((left, right) => left.tab - right.tab || left.index - right.index).map(value => value.id);
  const representatives = new Map();
  for (const id of sorted) {
    const scope = onceScopes.get(id);
    if (scope != null && (!representatives.has(scope) || id === current)) representatives.set(scope, id);
  }
  return sorted.filter(id => !onceScopes.has(id) || representatives.get(onceScopes.get(id)) === id);
}

export function nextTabStop(order, current, backwards = false, cycle = false) {
  if (!order.length) return null;
  const found = order.indexOf(current);
  const index = found < 0 ? backwards ? order.length : -1 : found;
  const next = index + (backwards ? -1 : 1);
  return next >= 0 && next < order.length ? order[next] : cycle ? order[(next + order.length) % order.length] : null;
}

/** Directional search prioritizes alignment, then distance, while retaining deterministic tree-order ties. */
export function findDirectionalFocus(current, candidates, direction) {
  const horizontal = direction === 'Left' || direction === 'Right';
  const sign = direction === 'Left' || direction === 'Up' ? -1 : 1;
  const sourceMain = horizontal ? current.x + current.width / 2 : current.y + current.height / 2;
  const sourceCross = horizontal ? current.y + current.height / 2 : current.x + current.width / 2;
  let best = null;
  let score = Infinity;
  for (const candidate of candidates) {
    const bounds = candidate.bounds;
    const main = (horizontal ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2) - sourceMain;
    if (main * sign <= 0) continue;
    const cross = Math.abs((horizontal ? bounds.y + bounds.height / 2 : bounds.x + bounds.width / 2) - sourceCross);
    const value = main * main + cross * cross * 4;
    if (value < score) { score = value; best = candidate.id; }
  }
  return best;
}

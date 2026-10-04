/** Ordered source intervals give O(n log n) ownership without rescanning all types for every member. */
export function symbolOwners(pairs, typeKinds, byId, byName) {
  const parents = new Map();
  const stack = [];
  const ordered = pairs.filter(({symbol}) => Number.isFinite(symbol.start) && Number.isFinite(symbol.end) && symbol.end >= symbol.start)
    .sort((left, right) => left.symbol.start - right.symbol.start || right.symbol.end - left.symbol.end);
  for (const pair of ordered) {
    const {symbol, node} = pair;
    while (stack.length && (stack.at(-1).symbol.end < symbol.end ||
      stack.at(-1).symbol.start === symbol.start && stack.at(-1).symbol.end === symbol.end)) stack.pop();
    if (stack.length) parents.set(node, stack.at(-1).node);
    if (typeKinds.has(symbol.kind)) stack.push(pair);
  }
  for (const {symbol, node} of pairs) {
    const ownerId = symbol.ownerId ?? symbol.containingTypeId;
    const owner = ownerId !== undefined ? byId.get(ownerId) : null;
    const candidates = symbol.owner ? byName.get(symbol.owner) : null;
    const named = candidates?.length === 1 && candidates[0] !== node ? candidates[0] : null;
    if (owner && owner !== node) parents.set(node, owner);
    else if (named && !parents.has(node)) parents.set(node, named);
  }
  // Malformed metadata can name cycles even when source ranges are sound. Detach one edge so the diagnostic remains renderable.
  const visited = new Set();
  let cyclic = false;
  for (const {node} of pairs) {
    const trail = new Set();
    let current = node;
    while (current && !visited.has(current)) {
      if (trail.has(current)) { parents.delete(current); cyclic = true; break; }
      trail.add(current);
      current = parents.get(current);
    }
    for (const item of trail) visited.add(item);
  }
  return {parents, cyclic};
}

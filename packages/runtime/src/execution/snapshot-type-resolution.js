/** Resolve portable type identities transactionally: rejected input does not populate live type caches. */
export function resolveSnapshotTypes(vm, action) {
  const registry = vm.heap.methodTables;
  const tables = new Map(registry.tables), tokens = new Map(registry.tokens);
  const building = new Set(registry.building), nextToken = registry.nextToken;
  try {
    return action();
  } catch (error) {
    registry.tables.clear();
    for (const [key, value] of tables) registry.tables.set(key, value);
    registry.tokens.clear();
    for (const [key, value] of tokens) registry.tokens.set(key, value);
    registry.building.clear();
    for (const value of building) registry.building.add(value);
    registry.nextToken = nextToken;
    throw error;
  }
}

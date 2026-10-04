import { fail } from './contracts.js';
import { defaultParseBudgets } from './budgets.js';

function parents(scopes) {
  const depths = new Uint16Array(scopes.length + 1);
  for (let id = 1; id <= scopes.length; id++) {
    if (depths[id]) continue;
    const path = [],
      seen = new Set();
    let current = id;
    while (current && !depths[current]) {
      if (seen.has(current)) fail('Import scope cycle');
      if (path.length >= 256) fail('Import scope depth limit exceeded');
      seen.add(current);
      path.push(current);
      const parent = scopes[current - 1].parent;
      if (!Number.isInteger(parent) || parent < 0 || parent > scopes.length) fail('Invalid parent import scope');
      current = parent;
    }
    let depth = depths[current];
    while (path.length) {
      if (++depth > 256) fail('Import scope depth limit exceeded');
      depths[path.pop()] = depth;
    }
  }
}

/** Snapshot validated import records; queries return fresh entries in parent-to-child recorded order. */
export function createImportLookup(imports) {
  if (imports.length > defaultParseBudgets.imports) fail('Import scope count limit exceeded');
  let count = 0;
  for (const scope of imports) {
    if ((count += scope.definitions.length) > defaultParseBudgets.imports)
      fail('Import definition count limit exceeded');
  }
  parents(imports);
  const scopes = imports.map((scope) => ({
    parent: scope.parent,
    definitions: scope.definitions.map((definition) => ({
      ...definition,
      scopeId: scope.id,
      resolved: !definition.assembly && !definition.type,
      reason: definition.assembly || definition.type ? 'type-metadata-required' : null,
    })),
  }));
  return (scopeId) => {
    if (!Number.isInteger(scopeId) || scopeId < 0 || scopeId > scopes.length) fail('Invalid import scope id');
    const chain = [];
    for (let id = scopeId; id; id = scopes[id - 1].parent) chain.push(id);
    const result = [];
    for (let index = chain.length - 1; index >= 0; index--) {
      for (const definition of scopes[chain[index] - 1].definitions) result.push({ ...definition });
    }
    return result;
  };
}

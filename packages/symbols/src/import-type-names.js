import { fail } from './contracts.js';
import { metadataName } from './metadata-facts.js';
import { createMetadataTypeNames } from './metadata-type-names.js';

function snapshotNames(imports, metadata) {
  const types = new Map(),
    assemblies = new Map();
  const { resolve } = createMetadataTypeNames(metadata);
  for (const scope of imports)
    for (const definition of scope.definitions) {
      if (definition.type && !types.has(definition.type)) types.set(definition.type, resolve(definition.type));
      if (definition.assembly && !assemblies.has(definition.assembly)) {
        if (assemblies.size >= 4096) fail('Import assembly count limit exceeded');
        const row = metadata.row(0x23000000 | definition.assembly);
        assemblies.set(definition.assembly, metadataName(metadata, row[6], 'Import assembly'));
      }
    }
  return { types, assemblies };
}

/** Resolve names while PE metadata is available; the returned query retains only strings and the owned scope lookup. */
export function bindImportNames(lookup, imports, metadata) {
  const { types, assemblies } = snapshotNames(imports, metadata);
  return (scopeId) => {
    const definitions = lookup(scopeId);
    for (const definition of definitions) {
      if (definition.type) definition.typeName = types.get(definition.type);
      if (definition.assembly) definition.assemblyName = assemblies.get(definition.assembly);
      definition.resolved = true;
      definition.reason = null;
    }
    return definitions;
  };
}

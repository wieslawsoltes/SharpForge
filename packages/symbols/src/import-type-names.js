import { decodeTypeSignature, formatSignatureType } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { metadataName } from './metadata-facts.js';

function typeNames(metadata) {
  const names = new Map(),
    active = new Set();
  let blobBytes = 0,
    nameChars = 0;
  const adapter = { ...metadata, string: (index) => metadataName(metadata, index, 'Import type') };
  function references(node, state) {
    if (!node || typeof node !== 'object') return;
    if (node.token) {
      state.characters += resolve(node.token, state.depth + 1).length;
      if (state.characters > 16384) fail('Import type expansion limit exceeded');
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) references(child, state);
      else if (value && typeof value === 'object') references(value, state);
    }
  }
  function resolve(token, depth = 0) {
    if (depth > 32 || active.has(token)) fail('Import type recursion limit exceeded');
    if (names.has(token)) return names.get(token);
    if (names.size + active.size >= 4096) fail('Import type count limit exceeded');
    active.add(token);
    let name;
    if (token >>> 24 === 27) {
      const bytes = metadata.blob(metadata.row(token)[0]);
      if (bytes.length > 4096 || (blobBytes += bytes.length) > 1024 * 1024) fail('Import TypeSpec byte limit exceeded');
      const type = decodeTypeSignature(bytes, { maxDepth: 32, maxNodes: 256 });
      references(type, { characters: 0, depth });
      name = formatSignatureType(type, { typeName: resolve }, { maxDepth: 32, maxNodes: 256, initialDepth: depth });
    } else {
      if (token >>> 24 !== 1 && token >>> 24 !== 2) fail('Invalid import type handle');
      if (token >>> 24 === 2 && (metadata.rows[41]?.length ?? 0) > 65536)
        fail('Import nested type count limit exceeded');
      name = metadata.typeName.call(adapter, token, depth);
    }
    if (name.length > 4096 || (nameChars += name.length) > 1024 * 1024) fail('Import type name limit exceeded');
    names.set(token, name);
    active.delete(token);
    return name;
  }
  adapter.typeName = resolve;
  return resolve;
}

function snapshotNames(imports, metadata) {
  const types = new Map(),
    assemblies = new Map();
  const resolve = typeNames(metadata);
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

import {decodeCoded} from './metadata.js';

/** Per-inspector local definitions and total GenericParam arity; construction is O(types + rows). */
export function localGenericType(inspector, name) {
  let names = inspector.genericTypeInventory;
  if (!names) {
    const definitions = new Map(inspector.types.map(type => [type.token, {type, arity: 0}]));
    for (const row of inspector.metadata.rows?.[42] ?? []) {
      const owner = decodeCoded('TypeOrMethodDef', row[2]);
      if (owner >>> 24 !== 2) continue;
      const definition = definitions.get(owner);
      if (definition) definition.arity++;
    }
    names = new Map();
    for (const definition of definitions.values()) {
      // Preserve the existing first-definition lookup; duplicate-name admission is a separate metadata check.
      if (!names.has(definition.type.name)) names.set(definition.type.name, Object.freeze(definition));
    }
    inspector.genericTypeInventory = names;
  }
  return names.get(name);
}

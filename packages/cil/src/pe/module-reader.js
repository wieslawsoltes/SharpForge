import { CilError } from '../binary.js';
import { decodeCoded } from '../metadata/indices.js';
import { moduleFileName, moduleLimits, moduleMetadataName } from './module-exports.js';

/** Inspect linked metadata modules without loading files. Returned hashes are owned copies; exports retain real tokens. */
export function readAssemblyModules(pe) {
  const metadata = pe.metadata, files = metadata.rows[38] ?? [], exports = metadata.rows[39] ?? [];
  const refs = metadata.rows[26] ?? [];
  if (files.length > moduleLimits.files || exports.length > moduleLimits.exports || refs.length > moduleLimits.types) {
    throw new CilError('Linked module manifest limit exceeded');
  }
  const moduleRefs = new Map(refs.map((row, index) => [moduleMetadataName(metadata, row[0]), 0x1a000001 + index]));
  const modules = new Map(), names = new Set();
  files.forEach((row, index) => {
    if (row[0] & ~1) throw new CilError('Invalid linked File flags');
    if (row[0] & 1) return;
    const name = moduleFileName(moduleMetadataName(metadata, row[1])), hash = metadata.blob(row[2]), fileToken = 0x26000001 + index;
    if (hash.length > 64) throw new CilError('Linked module file hash limit exceeded');
    if (names.has(name.toLowerCase())) throw new CilError('Duplicate linked module name');
    names.add(name.toLowerCase());
    modules.set(fileToken, { name, fileToken, moduleRefToken: moduleRefs.get(name) ?? null,
      hashAlgorithm: metadata.rows[32]?.[0]?.[0] ?? null, hashValue: new Uint8Array(hash), exportedTypes: [] });
  });
  const owners = new Map();
  function owner(id, depth = 0) {
    if (depth > 64 || owners.get(id) === false) throw new CilError('Cyclic or excessive exported type nesting');
    if (owners.has(id)) return owners.get(id);
    const row = exports[id - 1];
    if (!row) throw new CilError('Invalid exported type implementation');
    owners.set(id, false);
    const implementation = decodeCoded('Implementation', row[4]), table = implementation >>> 24;
    const result = table === 39 ? owner(implementation & 0xffffff, depth + 1)
      : table === 38 ? modules.get(implementation) : table === 35 ? null : undefined;
    if (result === undefined) throw new CilError('Invalid exported type module');
    owners.set(id, result);
    return result;
  }
  exports.forEach((row, index) => {
    const module = owner(index + 1);
    if (!module) return;
    const name = moduleMetadataName(metadata, row[2]), namespace = moduleMetadataName(metadata, row[3], true);
    if (!name || name.length > 512 || namespace.length > 512) throw new CilError('Invalid exported type name');
    module.exportedTypes.push({ token: 0x27000001 + index, name, namespace, flags: row[0], typeDefId: row[1],
      implementation: decodeCoded('Implementation', row[4]) });
  });
  return [...modules.values()];
}

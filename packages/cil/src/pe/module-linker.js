import { CilError } from '../binary.js';
import { sha256 } from '../binary/hash.js';
import { readPortableExecutable } from './reader.js';
import { moduleFileName, moduleLimits, moduleMetadataName, moduleTypeExports } from './module-exports.js';

function inspectInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length > moduleLimits.files) throw new CilError('Invalid linked module count');
  let bytes = 0, types = 0, exports = 0;
  for (const input of inputs) {
    if (!(input instanceof Uint8Array)) throw new CilError('Linked module bytes must be Uint8Array');
    bytes += input.length;
    if (bytes > moduleLimits.bytes) throw new CilError('Linked module input size limit exceeded');
  }
  return inputs.map(input => {
    const pe = readPortableExecutable(input, { inspection: true }), metadata = pe.metadata;
    if (metadata.rows[32]?.length || metadata.rows[0]?.length !== 1 || pe.entryPoint) {
      throw new CilError('Linked input must be a netmodule with no Assembly manifest or entry point');
    }
    types += metadata.rows[2]?.length ?? 0;
    if (types > moduleLimits.types) throw new CilError('Linked module aggregate type limit exceeded');
    for (const row of metadata.rows[2] ?? []) if ([1, 2].includes(row[0] & 7)) exports++;
    if (exports > moduleLimits.exports) throw new CilError('Linked module exported type limit exceeded');
    return { input, metadata, name: moduleFileName(moduleMetadataName(metadata, metadata.rows[0][0][1])) };
  });
}

/** Add one bounded module set to an Assembly builder. Returns File/ModuleRef/export tokens; owns hashes, not input bytes. */
export function linkAssemblyModules(builder, inputs) {
  const modules = inspectInputs(inputs);
  if (!modules.length) return [];
  if (builder.rows[32]?.length !== 1 || builder.rows[0]?.length !== 1) {
    throw new CilError('Linked modules require a containing Assembly manifest');
  }
  if (builder.rows[38]?.length || builder.rows[39]?.length) throw new CilError('Link modules before adding other File/ExportedType rows');
  const strings = new Map([...builder.heaps.stringMap].map(([value, index]) => [index, value]));
  const budget = { count: 0 }, names = new Set(), typeNames = new Set();
  const local = moduleTypeExports({ rows: builder.rows, string: index => strings.get(index) ?? '' }, { count: 0 });
  for (const type of local) typeNames.add(type.fullName);
  const primaryName = moduleFileName(strings.get(builder.rows[0][0][1])).toLowerCase();
  for (const module of modules) {
    const name = module.name.toLowerCase();
    if (name === primaryName || names.has(name)) throw new CilError(`Duplicate linked module name: ${module.name}`);
    names.add(name);
    module.exports = moduleTypeExports(module.metadata, budget);
    for (const type of module.exports) {
      if (typeNames.has(type.fullName)) throw new CilError(`Duplicate linked exported type: ${type.fullName}`);
      typeNames.add(type.fullName);
    }
  }
  // All validation precedes mutation; SHA-256 is shared with PE content identities.
  builder.rows[32][0][0] = 0x800c;
  const moduleRefs = new Map((builder.rows[26] ?? []).map((row, index) => [strings.get(row[0]), 0x1a000001 + index]));
  return modules.map(module => {
    const fileToken = builder.manifest.file({ Flags: 0, Name: module.name, HashValue: sha256(module.input) });
    const moduleRefToken = moduleRefs.get(module.name) ?? builder.manifest.moduleRef({ Name: module.name });
    const exportedTypes = module.exports.map(type => {
      const token = builder.manifest.exportedType({ Flags: type.flags, TypeDefId: type.id, TypeName: type.name,
        TypeNamespace: type.namespace, Implementation: type.parent?.token ?? fileToken });
      type.token = token;
      return { token, name: type.fullName, typeDefId: type.id };
    });
    return { name: module.name, fileToken, moduleRefToken, exportedTypes };
  });
}

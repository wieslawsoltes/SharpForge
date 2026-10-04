import {sourceTypeIdentities} from '@sharpforge/bytecode';
import {CilError, text} from './binary.js';
import {decodeCoded} from './metadata.js';

/** Type mappings carry an optional logical identity; physical TypeDef tokens and signatures are unchanged. */
export function sourceTypeMappings(image, tokens) {
  const identities = sourceTypeIdentities(image.types);
  return image.types.map(type => ({id: type.id, token: tokens.get(type.name), initializer: type.initializer,
    ...(identities.has(type.name) ? {sourceIdentity: identities.get(type.name)} : {})}));
}

/** Logical identities are semantic metadata and survive source/debug-information stripping. */
export function sourceIdentityMetadata(debug, includeDebug) {
  if (includeDebug) return debug;
  const types = debug.types.filter(type => type.sourceIdentity).map(type => ({token: type.token, sourceIdentity: type.sourceIdentity}));
  return types.length ? {format: 'SharpForge.TypeIdentity', version: 1, types} : null;
}

/** Read bounded, owned logical identities only for non-generic physical source TypeDefs; ordinary CLI metadata is unchanged. */
export function readSourceTypeIdentities(input) {
  const metadata = input.metadata ?? input;
  const bytes = metadata.streams.get('#SF');
  if (!bytes) return new Map();
  let data;
  try {
    data = input.metadata && input.debug ? input.debug : JSON.parse(text(bytes));
  } catch {
    throw new CilError('Invalid SharpForge type identity metadata');
  }
  if (!['SharpForge.CIL', 'SharpForge.TypeIdentity'].includes(data?.format)) return new Map();
  if (data.version !== 1 || !Array.isArray(data.types) || data.types.length > 100000) {
    throw new CilError('Invalid SharpForge type identity metadata');
  }
  const owners = new Set((metadata.rows[42] ?? []).map(row => decodeCoded('TypeOrMethodDef', row[2])));
  const definitions = new Set((metadata.rows[2] ?? []).map((_, index) => metadata.typeName(0x02000001 + index)));
  const tokens = new Map();
  const types = [];
  for (const item of data.types) {
    if (item.sourceIdentity === undefined) continue;
    if (definitions.has(item.sourceIdentity?.name)) throw new CilError('Source type identity collides with a CLI type definition');
    if (!Number.isInteger(item.token) || item.token >>> 24 !== 2 || tokens.has(item.token) || owners.has(item.token)) {
      throw new CilError('Invalid source type identity token');
    }
    metadata.row(item.token);
    const name = metadata.typeName(item.token);
    types.push({name, sourceIdentity: item.sourceIdentity});
    tokens.set(item.token, name);
  }
  try {
    const identities = sourceTypeIdentities(types);
    return new Map([...tokens].map(([token, name]) => [token, identities.get(name)]));
  } catch (error) {
    throw new CilError(error.message);
  }
}

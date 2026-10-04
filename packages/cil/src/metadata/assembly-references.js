import { CilError } from '../binary.js';
import { normalizeAssemblyVersion, normalizeAssemblyCulture } from './assembly-identity.js';

export const maxAssemblyReferences = 1024;
export const maxAssemblyReferenceKeyBytes = 16384;

/** Copy bounded reference identities; full public keys use the ECMA PublicKey flag. */
export function assemblyReferenceRegistry(references = []) {
  if (!Array.isArray(references) || references.length > maxAssemblyReferences) throw new CilError('Invalid assembly reference identity count');
  const registry = new Map();
  for (const reference of references) {
    const name = reference?.name;
    if (typeof name !== 'string' || !name || name.length > 512 || /[\0/\\]/.test(name)) {
      throw new CilError('Invalid assembly reference name');
    }
    const flags = reference.flags ?? 0, key = reference.publicKeyOrToken ?? new Uint8Array();
    if (!Number.isInteger(flags) || flags < 0 || flags > 0x301 || (flags & ~0x301) || !(key instanceof Uint8Array)
      || key.length > maxAssemblyReferenceKeyBytes || (flags & 1 ? key.length < 16 : key.length !== 0 && key.length !== 8)) {
      throw new CilError('Invalid assembly reference flags or public key/token');
    }
    if (reference.version === undefined) throw new CilError('Assembly reference version must be explicit');
    const value = { name, version: normalizeAssemblyVersion(reference.version), culture: normalizeAssemblyCulture(reference.culture),
      flags, publicKeyOrToken: new Uint8Array(key) };
    const lookup = name.toLowerCase();
    if (registry.has(lookup)) throw new CilError(`Duplicate assembly reference identity: ${name}`);
    registry.set(lookup, value);
  }
  return registry;
}

function fallbackReference(builder, name) {
  const custom = name === 'SharpForge.WinUI' || name === 'SharpForge.Runtime', legacy = builder.framework === 'mscorlib4';
  if (!custom && ['net9', 'net10'].includes(builder.framework)) {
    throw new CilError(`Missing input assembly reference identity for ${name} in ${builder.framework}`);
  }
  return { name, version: custom ? [0, 10, 0, 0] : [legacy ? 4 : 8, 0, 0, 0], culture: '', flags: 0,
    publicKeyOrToken: custom ? new Uint8Array() : Uint8Array.from(legacy
      ? [0xb7, 0x7a, 0x5c, 0x56, 0x19, 0x34, 0xe0, 0x89] : [0xb0, 0x3f, 0x5f, 0x7f, 0x11, 0xd5, 0x0a, 0x3a]) };
}

function referenceKey(name) {
  if (typeof name !== 'string' || !name || name.length > 512) throw new CilError('Invalid assembly reference name');
  return name.toLowerCase();
}

function resolveReference(builder, name, lookup = referenceKey(name)) {
  return builder.referenceIdentities.get(lookup) ?? fallbackReference(builder, name);
}

/** Resolve the identity emission uses, without adding a row; version and key bytes are defensive copies. */
export function assemblyReferenceIdentity(builder, name) {
  const identity = resolveReference(builder, name);
  return { ...identity, version: [...identity.version], publicKeyOrToken: new Uint8Array(identity.publicKeyOrToken) };
}

/** Intern one referenced identity, keeping historical fallback profiles unchanged. */
export function writeAssemblyReference(builder, name) {
  const lookup = referenceKey(name);
  if (builder.assemblyRefs.has(lookup)) return builder.assemblyRefs.get(lookup);
  const identity = resolveReference(builder, name, lookup);
  const result = builder.add(35, [...identity.version, identity.flags, identity.publicKeyOrToken.length ? builder.blob(identity.publicKeyOrToken) : 0,
    builder.string(identity.name), builder.string(identity.culture), 0]);
  builder.assemblyRefs.set(lookup, result);
  return result;
}

/** Recover AssemblyRef identity inputs for canonical replay without resolving or loading any assembly. */
export function readAssemblyReferenceIdentities(metadata) {
  const rows = metadata.rows[35] ?? [];
  if (rows.length > maxAssemblyReferences) throw new CilError('Invalid assembly reference identity count');
  return rows.map(row => {
    const key = metadata.blob(row[5]);
    if (key.length > maxAssemblyReferenceKeyBytes) throw new CilError('Assembly reference public key/token exceeds size limit');
    return { name: metadata.string(row[6]), version: row.slice(0, 4), culture: metadata.string(row[7]),
      flags: row[4], publicKeyOrToken: new Uint8Array(key) };
  });
}

import { importAssembly } from './metadata-import/pe-symbols.js';

/** Validate a PE/CLI reference without executing it; malformed images throw the metadata reader's explicit error. */
export function inspectMetadataReference(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 67108864) throw new RangeError('Metadata reference byte limit exceeded');
  const assembly = importAssembly(bytes);
  return { name: assembly.name, identity: assembly.identity.getDisplayName(), references: assembly.referencedAssemblyIdentities.length };
}

import { CilError } from '../binary.js';
import { maxAssemblyReferences, maxAssemblyReferenceKeyBytes } from '../metadata/assembly-references.js';
import { readPortableExecutable } from '../pe/reader.js';

/** Project supplied assembly metadata into identities at the emitter boundary, before constructing tables. */
export function emissionMetadataOptions(options, framework) {
  const input = options.referenceAssemblies === undefined ? [] : options.referenceAssemblies;
  if (!Array.isArray(input) || input.length > maxAssemblyReferences) throw new CilError('Invalid reference assembly count');
  if (options.assemblyReferences !== undefined
    && (!Array.isArray(options.assemblyReferences) || options.assemblyReferences.length + input.length > maxAssemblyReferences)) {
    throw new CilError('Invalid assembly reference identity list');
  }
  let total = 0;
  for (const bytes of input) {
    if (!(bytes instanceof Uint8Array)) throw new CilError('Reference assembly bytes must be Uint8Array');
    total += bytes.length;
    if (total > 64 * 1024 * 1024) throw new CilError('Reference assembly inputs exceed size limit');
  }
  const identities = input.map(bytes => {
    const metadata = readPortableExecutable(bytes, { inspection: true }).metadata, rows = metadata.rows[32];
    if (rows?.length !== 1) throw new CilError('Reference assembly must contain exactly one Assembly definition');
    const row = rows[0], key = metadata.blob(row[6]);
    if (key.length > maxAssemblyReferenceKeyBytes) throw new CilError('Assembly reference public key/token exceeds size limit');
    return { name: metadata.string(row[7]), version: row.slice(1, 5), culture: metadata.string(row[8]),
      flags: row[5] & 0x301, publicKeyOrToken: new Uint8Array(key) };
  });
  return { ...options, framework, assemblyReferences: [...(options.assemblyReferences ?? []), ...identities] };
}

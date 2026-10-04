import { readAssemblyReferenceIdentities } from '../metadata/assembly-references.js';
import { assemblyDefinitionOptions } from '../metadata/assembly-identity.js';
import { canonicalStrongNameOptions } from './strong-name.js';
import { readWin32Resources } from './win32-reader.js';
import { readManagedResources } from './managed-resources.js';
import { CilError } from '../binary.js';

/** Reconstruct source-emission inputs from bounded resource data, never executable debug payloads. */
export function canonicalEmissionOptions(pe, debug) {
  if (pe.metadata.rows[38]?.some(row => !(row[0] & 1))) {
    throw new CilError('Multi-module assembly execution requires module resolution, which is unsupported');
  }
  const managedResources = readManagedResources(pe, { includeBytes: true }).map(resource => {
    if (resource.implementation || ![1, 2].includes(resource.flags)) throw new CilError('Unsupported canonical managed resource');
    return { name: resource.name, bytes: resource.bytes, visibility: resource.flags === 1 ? 'public' : 'private' };
  });
  const entries = readWin32Resources(pe, { includeBytes: true });
  return { ...debug.peOptions, ...assemblyDefinitionOptions(pe.metadata), ...canonicalStrongNameOptions(pe),
    name: debug.name, framework: debug.framework, assemblyReferences: readAssemblyReferenceIdentities(pe.metadata),
    embedSources: debug.sources.every(source => typeof source.text === 'string'), managedResources,
    ...(pe.directories.resource.size ? { win32Resources: { entries } } : {}) };
}

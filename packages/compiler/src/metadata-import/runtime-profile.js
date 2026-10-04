import { coreTypeDescriptor } from '../symbols/special-types.js';

const profileAssemblies = new Set(['mscorlib', 'System.Private.CoreLib', 'System.Runtime', 'netstandard',
  'System.Collections', 'System.Console', 'System.Diagnostics.Debug', 'SharpForge.Runtime', 'SharpForge.WinUI']);

/** Explicit SharpForge-produced references share the consuming compilation's closed framework type identities. */
export function createRuntimeProfileResolver(bridge) {
  return {
    coreType(id) {
      return coreTypeDescriptor(id) ? bridge.coreType(id) : null;
    },
    resolveType(metadataName, assemblyIdentity) {
      if (!profileAssemblies.has(assemblyIdentity.name)) return null;
      const id = metadataName.replace(/`\d+$/, '_T').replaceAll('.', '_');
      if (coreTypeDescriptor(id)) return bridge.coreType(id);
      const match = /^(.*?)(?:`(\d+))?$/.exec(metadataName);
      return bridge.globalNamespace.lookupType(match[1], Number(match[2] ?? 0)) ?? bridge.typeFromName(metadataName);
    }
  };
}

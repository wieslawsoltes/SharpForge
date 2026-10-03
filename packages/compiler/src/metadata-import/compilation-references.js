/**
 * Assembly references of a compilation (SF-A02-T20, T22): turns the `references` option of `compile()` into the
 * global namespaces name lookup searches and the core library the predefined types come from.
 *
 * Without references the closed framework registry is the only library. With references, the reference manager
 * binds them (identity unification, duplicates, extern aliases, type forwarding) and their namespaces are merged
 * in; when one of them is a core library (it defines System.Object) its types replace the registry's for the
 * predefined types, so `int`, `string`, `Console` and `List<T>` are the imported symbols with their real members.
 */
import { bindReferences } from './reference-manager.js';
import { coreTypeDescriptor } from '../symbols/special-types.js';

/** The registry as the core library: every predefined type comes from the bridge. */
class RegistryCoreLibrary {
  constructor(bridge) {
    this.bridge = bridge;
  }
  get coreAugmented() {
    return this.bridge.coreAugmented;
  }
  set coreAugmented(value) {
    this.bridge.coreAugmented = value;
  }
  coreType(id) {
    return this.bridge.coreType(id);
  }
}

/** A referenced core library: predefined types are looked up in its metadata, falling back to the registry for types it lacks. */
class MetadataCoreLibrary {
  constructor(assembly, bridge) {
    this.assembly = assembly;
    this.bridge = bridge;
    // Imported types already carry their full member lists; nothing needs to be added.
    this.coreAugmented = true;
    this.cache = new Map();
  }
  coreType(id) {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const descriptor = coreTypeDescriptor(id);
    const imported = descriptor ? this.assembly.getTypeByMetadataName(descriptor.metadataName) : null;
    const type = imported ?? this.bridge.coreType(id);
    if (imported && imported._specialType == null && id.startsWith('System_')) imported._specialType = imported.specialType ?? null;
    this.cache.set(id, type);
    return type;
  }
}

/**
 * @param {object[]|undefined} references `{ bytes: Uint8Array }` or `{ assembly }` entries with optional `aliases`
 *   and `display`, as `ReferenceManager` takes them
 * @param bridge the framework registry bridge
 * @returns {{ coreLibrary: object, globalNamespaces: object[], diagnostics: {code:string,args:any[]}[],
 *   hasCoreLibrary: boolean, manager: object|null, useSiteDiagnostics(symbol): {code:string,args:any[]}[] }}
 */
export function bindCompilationReferences(references, bridge) {
  if (!references?.length) {
    return {
      coreLibrary: new RegistryCoreLibrary(bridge),
      globalNamespaces: [bridge.globalNamespace],
      diagnostics: [],
      hasCoreLibrary: false,
      manager: null,
      useSiteDiagnostics: () => [],
    };
  }
  const manager = bindReferences(references);
  const referenced = manager.globalNamespace;
  const coreAssembly = manager.corLibrary;
  const globalNamespaces = [];
  // A referenced core library replaces the registry; otherwise the registry stays the source of System.* types.
  if (!coreAssembly) globalNamespaces.push(bridge.globalNamespace);
  if (referenced) globalNamespaces.push(referenced);
  return {
    coreLibrary: coreAssembly ? new MetadataCoreLibrary(coreAssembly, bridge) : new RegistryCoreLibrary(bridge),
    globalNamespaces,
    diagnostics: [...manager.diagnostics, ...manager.unificationDiagnostics],
    hasCoreLibrary: !!coreAssembly,
    manager,
    useSiteDiagnostics: symbol => manager.useSiteDiagnostics(symbol),
  };
}

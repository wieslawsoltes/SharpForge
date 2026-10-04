/**
 * Assembly references of a compilation (SF-A02-T20, T22): turns the `references` option of `compile()` into the
 * global namespaces name lookup searches and the core library the predefined types come from.
 *
 * Without references the closed framework registry is the only library. With references, the reference manager
 * binds them (identity unification, duplicates, extern aliases, type forwarding) and their namespaces are merged
 * in; when one of them is a core library (it defines System.Object) its types replace the registry's for the
 * predefined types, so `int`, `string`, `Console` and `List<T>` are the imported symbols with their real members.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { bindReferences, unificationCodes } from './reference-manager.js';
import { coreTypeDescriptor } from '../symbols/special-types.js';
import { readCompilationReferences } from './reference-input.js';

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

/**
 * A referenced core library: predefined types are looked up in its metadata, then in the other references (the
 * reference pack defines `List<T>` in System.Collections and `Expression<T>` in System.Linq.Expressions), falling
 * back to the registry for types no reference has.
 */
class MetadataCoreLibrary {
  constructor(assembly, bridge, manager = null) {
    this.assembly = assembly;
    this.bridge = bridge;
    this.manager = manager;
    // Imported types already carry their full member lists; nothing needs to be added.
    this.coreAugmented = true;
    this.cache = new Map();
  }
  coreType(id) {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const descriptor = coreTypeDescriptor(id);
    const imported = descriptor ? (this.assembly.getTypeByMetadataName(descriptor.metadataName) ?? this.referencedType(descriptor.metadataName)) : null;
    const type = imported ?? this.bridge.coreType(id);
    if (imported && imported._specialType == null && id.startsWith('System_')) imported._specialType = imported.specialType ?? null;
    this.cache.set(id, type);
    return type;
  }
  /** A type one of the other references defines (or forwards to a referenced assembly), or null. */
  referencedType(metadataName) {
    const found = this.manager?.getTypeByMetadataName(metadataName) ?? null;
    return found && !found.isErrorType?.() ? found : null;
  }
}

/**
 * @param {object[]|undefined} references `{ bytes: Uint8Array }` or `{ assembly }` entries with optional `aliases`
 *   and `display`, as `ReferenceManager` takes them
 * @param bridge the framework registry bridge
 * @returns {{ coreLibrary: object, globalNamespaces: object[], diagnostics: {code:string,args:any[]}[],
 *   hasCoreLibrary: boolean, manager: object|null, useSiteDiagnostics(symbol, options): {code:string,args:any[]}[],
 *   externAlias(name): {alias, diagnostic}, forwardedToMissingAssembly(metadataName): string|null,
 *   isUnification(code): boolean }}
 *   `diagnostics` are the declaration-level ones (CS1703, CS1704). CS1701, CS1702 and CS1705 are use-site diagnostics:
 *   Roslyn reports them only when a symbol that crosses the unified reference is used.
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
      externAlias: name => ({ alias: null, diagnostic: { code: name === 'global' ? DiagnosticId.CS1681 : DiagnosticId.CS0430, args: name === 'global' ? [] : [name] } }),
      forwardedToMissingAssembly: () => null,
      isUnification: () => false,
    };
  }
  const imported = readCompilationReferences(references);
  const manager = bindReferences(imported.references);
  const referenced = manager.globalNamespace;
  const coreAssembly = manager.corLibrary;
  const globalNamespaces = [];
  // A referenced core library replaces the registry; otherwise the registry stays the source of System.* types.
  if (!coreAssembly) globalNamespaces.push(bridge.globalNamespace);
  if (referenced) globalNamespaces.push(referenced);
  return {
    coreLibrary: coreAssembly ? new MetadataCoreLibrary(coreAssembly, bridge, manager) : new RegistryCoreLibrary(bridge),
    globalNamespaces,
    diagnostics: [...imported.diagnostics, ...manager.diagnostics],
    hasCoreLibrary: !!coreAssembly,
    manager,
    useSiteDiagnostics: (symbol, options) => manager.useSiteDiagnostics(symbol, options),
    externAlias: name => manager.resolveExternAlias(name),
    forwardedToMissingAssembly: metadataName => manager.forwardedToMissingAssembly(metadataName),
    isUnification: code => unificationCodes.has(code),
  };
}

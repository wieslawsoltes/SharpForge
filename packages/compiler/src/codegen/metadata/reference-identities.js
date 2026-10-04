/**
 * The AssemblyRef identities of an emitted assembly when the compilation has reference assemblies.
 *
 * Without references the metadata builder writes its framework profile (`System.Runtime` 8.0.0.0 and the contract
 * table of reference-contracts.js). With references every imported type is referenced through the assembly that
 * defines it, with that assembly's real identity: name, version, culture and public key token.
 */
import { PEAssemblySymbol } from '../../metadata-import/pe-symbols.js';

const tokenBytes = hex => Uint8Array.from(hex.match(/../g) ?? [], pair => parseInt(pair, 16));

/**
 * @param analysis a SemanticAnalysis
 * @returns {object[]} `{name, version, culture, flags, publicKeyOrToken}` per referenced assembly, for the
 *   `assemblyReferences` option of the metadata builder; empty without references. Of two assemblies with the same
 *   simple name (already reported as CS1703 / CS1704) the first is kept.
 */
export function referenceIdentitiesOf(analysis) {
  const seen = new Set(),
    identities = [];
  for (const assembly of analysis.references?.manager?.assemblies ?? []) {
    const identity = assembly.identity,
      key = identity.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    identities.push({
      name: identity.name,
      version: [...identity.version],
      culture: identity.cultureName,
      flags: 0,
      publicKeyOrToken: tokenBytes(identity.publicKeyToken),
    });
  }
  return identities;
}

/** The simple name of the referenced assembly that defines an imported type, or undefined for any other type. */
export function referencedAssemblyOf(definition) {
  const assembly = definition.containingAssembly;
  return assembly instanceof PEAssemblySymbol ? assembly.name : undefined;
}

/**
 * The resolver `TypeTokens` asks for the assembly of a top-level type it references. An imported type names its own
 * assembly. A framework type that code generation names without a symbol from the references (framework-types.js:
 * `FormattableStringFactory`, an async method builder) is looked up in the references by its metadata name, so that
 * it is referenced through the assembly that really defines it.
 * @returns {(definition: object, fullName: string) => string|undefined}
 */
export function assemblyResolverOf(analysis) {
  const manager = analysis.references?.manager;
  if (!manager?.corLibrary) return referencedAssemblyOf;
  const byName = new Map();
  return (definition, fullName) => {
    const own = referencedAssemblyOf(definition);
    if (own) return own;
    if (!byName.has(fullName)) {
      const found = manager.getTypeByMetadataName(fullName);
      byName.set(fullName, found && !found.isErrorType?.() ? referencedAssemblyOf(found) : undefined);
    }
    return byName.get(fullName);
  };
}

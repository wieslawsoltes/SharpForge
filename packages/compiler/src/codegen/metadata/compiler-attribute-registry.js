/** One compiler-attribute contribution per metadata writer; mutable plans never escape to another emission. */
import { Accessibility } from '../../symbols/types.js';
import { markerAttributeContract } from './compiler-attribute-symbols.js';

export const EMBEDDED_ATTRIBUTE = 'Microsoft.CodeAnalysis.EmbeddedAttribute';

/**
 * Factories receive (analysis, existingTypeOrNull, registry) and return {type, constructor, plan, bodies, usage?}.
 * Existing contracts have no plan. Local definitions are appended once after every feature has registered its
 * requirements, before TypeTokens snapshots the TypeDef order. `get` never creates definitions during writing.
 */
export class CompilerAttributeRegistry {
  constructor(analysis) {
    this.analysis = analysis;
    this.contracts = new Map();
    this.definitions = new Map();
  }
  get(fullName) {
    return this.contracts.get(fullName) ?? null;
  }
  getOrCreate(fullName, factory) {
    const known = this.get(fullName);
    if (known) return known;
    const source = this.analysis.assembly.globalNamespace.lookupType(fullName, 0);
    const manager = this.analysis.references?.manager;
    const imported = manager?.corLibrary ? manager.getTypeByMetadataName(fullName) : this.analysis.globalNamespace.lookupType(fullName, 0);
    // Internal embedded attributes in another assembly are intentionally private to that compilation.
    const existing = source ?? (imported && !imported.isErrorType?.() && imported.declaredAccessibility === Accessibility.Public ? imported : null);
    const contract = factory(this.analysis, existing, this);
    this.contracts.set(fullName, contract);
    if (contract.plan) {
      if (fullName !== EMBEDDED_ATTRIBUTE) this.embedded();
      this.definitions.set(contract.type, contract);
    }
    return contract;
  }
  embedded() {
    return this.getOrCreate(EMBEDDED_ATTRIBUTE, (analysis, existing) =>
      markerAttributeContract(analysis, existing, { fullName: EMBEDDED_ATTRIBUTE }));
  }
}

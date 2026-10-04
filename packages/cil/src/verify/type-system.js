import { VerificationKind, verificationType, verificationError, requireVerificationType, isReference } from './types.js';
import { typeSystemBudget, unknown, yes } from './metadata-types/results.js';
import { snapshotTypes } from './metadata-types/snapshot.js';
import { metadataHierarchy } from './metadata-types/hierarchy.js';

export { verificationTypeSystemDiagnosticCatalog } from './metadata-types/results.js';

function requireKnown(result) {
  if (result.status === 'unknown') throw verificationError('CILV0003', `Unavailable verification relation: ${result.reason}`);
  return result.value;
}

/**
 * Snapshot one AssemblyInspector's local, non-generic TypeDef hierarchy.
 * Queries return frozen {status:'known', value} or {status:'unknown', reason, token}.
 * Identities belong to this adapter. Unresolved references never become accepted relations.
 */
export function createMetadataVerificationTypeSystem(inspector, options = {}) {
  return metadataTypeSystemState(inspector, options).types;
}

/** Internal composition seam: share any validated lexical forest without exposing it in public identities. */
export function metadataTypeSystemState(inspector, options = {}) {
  const budget = typeSystemBudget(options);
  const { snapshot, lexical } = snapshotTypes(inspector, budget, options.coreTypes);
  const hierarchy = metadataHierarchy(snapshot, budget);
  function reference(value) {
    requireVerificationType(value);
    if (!isReference(value)) throw verificationError('CILV0001', 'A reference verification type is required');
    hierarchy.requireType(value.type);
    return value.type;
  }
  function pointerAssignment(source, target) {
    hierarchy.requireType(source);
    hierarchy.requireType(target);
    return source === target ? yes : unknown('pointer-element-normalization');
  }
  const relations = Object.freeze({
    isAssignableTo(source, target) {
      return requireKnown(hierarchy.isAssignable(reference(source), reference(target)));
    },
    isPointerElementAssignableTo(source, target) { return requireKnown(pointerAssignment(source, target)); },
    commonSupertype(left, right) {
      return verificationType(VerificationKind.Object, requireKnown(hierarchy.commonBaseType(reference(left), reference(right))));
    },
  });
  const types = Object.freeze({
    resolveType: snapshot.resolve,
    baseType: hierarchy.baseType,
    interfaces: hierarchy.interfaces,
    isAssignable: hierarchy.isAssignable,
    commonBaseType: hierarchy.commonBaseType,
    typeCategory(type) {
      return hierarchy.requireType(type).category ?? unknown('unbound-type-category', type.token);
    },
    relations,
  });
  return { types, lexical };
}

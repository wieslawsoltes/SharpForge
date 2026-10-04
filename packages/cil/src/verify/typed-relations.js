import { signaturePrimitiveNodes } from '../metadata/signature-types.js';
import { VerificationKind, verificationType } from './types.js';
import { primitiveRelations, knownMetadata } from './typed-storage.js';

/** Compose intrinsic references with one local canonical hierarchy, without cross-module identity guesses. */
export function typedMetadataRelations(types, fail) {
  return Object.freeze({
    isAssignableTo(source, target) {
      if (target.type === signaturePrimitiveNodes.object) return true;
      if (source.type.kind === 'primitive' || target.type.kind === 'primitive') {
        if (source.type.kind === 'primitive' && target.type.kind === 'primitive')
          return primitiveRelations.isAssignableTo(source, target);
        fail('PrimitiveNominalRelationUnavailable', 'An intrinsic reference has no bound local nominal identity', true);
      }
      return knownMetadata(types.isAssignable(source.type, target.type), fail);
    },
    isPointerElementAssignableTo(source, target) {
      if (source === target) return true;
      fail('PointerElementNormalizationUnavailable', 'Distinct managed-pointer storage identities require normalization', true);
    },
    commonSupertype(left, right) {
      if (left.type.kind === 'primitive' || right.type.kind === 'primitive') return primitiveRelations.commonSupertype();
      const result = types.commonBaseType(left.type, right.type);
      return result.status === 'known' ? verificationType(VerificationKind.Object, result.value) : primitiveRelations.commonSupertype();
    },
  });
}

/** Nullable type uses of planned signatures, including the public members synthesized for delegates and events. */
import { RefKind, TypeKind, TypeWithAnnotations } from '../../symbols/types.js';
import { specialTypeFromMetadataName } from '../../symbols/special-types.js';
import { MetadataEmitError } from './type-tokens.js';

/** A type use has an annotation even when a code-generation shape supplies only its bare type. */
export function nullableTypeUse(type, core) {
  if (!type) return null;
  if (typeof type === 'string') {
    const id = specialTypeFromMetadataName(type);
    if (!id) throw new MetadataEmitError(`unknown planned nullable signature type '${type}'`);
    type = core.bridge.coreType(id);
  }
  return TypeWithAnnotations.create(type);
}

/**
 * Planned methods can lack symbols: event accessors repeat the event's type use and delegate async methods
 * repeat the Invoke signature. Their Param rows must carry the same annotations as the declared slots.
 */
export function nullableMethodSignature(type, method, events, core) {
  if (method.symbol) return {
    returned: method.symbol.returnTypeWithAnnotations,
    parameters: method.symbol.parameters.map(parameter => parameter.typeWithAnnotations),
  };
  const event = events.get(method);
  if (event) return { returned: nullableTypeUse(core.void, core), parameters: [event.typeWithAnnotations] };
  const invoke = type.typeKind === TypeKind.Delegate ? type.delegateInvokeMethod : null;
  const slots = method.shape?.parameters ?? method.parameters;
  const signature = {
    returned: nullableTypeUse(method.shape?.returnType, core),
    parameters: method.parameters.map((parameter, index) => nullableTypeUse(parameter.type ?? slots[index]?.type, core)),
  };
  if (invoke && method.name === 'BeginInvoke') {
    invoke.parameters.forEach((parameter, index) => { signature.parameters[index] = parameter.typeWithAnnotations; });
  } else if (invoke && method.name === 'EndInvoke') {
    signature.returned = invoke.returnTypeWithAnnotations;
    const byReference = invoke.parameters.filter(parameter => parameter.refKind && parameter.refKind !== RefKind.None);
    byReference.forEach((parameter, index) => { signature.parameters[index] = parameter.typeWithAnnotations; });
  }
  return signature;
}

/** Definition annotations describe the reference constraint, not a use of the type parameter in a signature. */
export function nullableTypeParameterFlag(parameter, annotationsEnabled) {
  if (parameter.hasValueTypeConstraint || parameter.hasUnmanagedTypeConstraint) return 0;
  if (parameter.hasNotNullConstraint) return 1;
  if (parameter.hasReferenceTypeConstraint) return parameter.referenceTypeConstraintIsNullable ? 2 : annotationsEnabled ? 1 : 0;
  if (parameter.constraintTypes?.length) return 0;
  return annotationsEnabled ? 2 : 0;
}

/** Source constraints keep bare symbol identity and preserve their outer annotation in an additive sidecar. */
export function nullableConstraintType(parameter, constraint) {
  return parameter.constraintTypesWithAnnotations?.get(constraint) ?? TypeWithAnnotations.create(constraint);
}

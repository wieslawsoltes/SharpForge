import {CilError} from './binary.js';
import {verifyGenericType} from './generic-profile.js';

/** Validate a metadata handle without requiring storage for an open type definition. */
export function verifyExecutionToken(inspector, value, context) {
  const descriptor = inspector.resolveToken(value);
  if (!['type', 'method', 'field'].includes(descriptor.kind)) {
    throw new CilError('ldtoken requires a type, method or field');
  }
  // TypeDef and TypeRef name definitions, including List<T> itself. Loading their
  // handles allocates no generic storage. TypeSpec still carries a signature whose
  // variables and constructed arity must be valid in the current declaring context.
  if (descriptor.kind === 'type' && descriptor.token >>> 24 === 27) {
    verifyGenericType(inspector, descriptor.name, context);
  }
}

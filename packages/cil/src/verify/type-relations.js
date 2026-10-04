import {
  VerificationKind, verificationError, requireVerificationType, sameVerificationType, isReference, isManagedPointer,
} from './types.js';

function relation(relations, name, source, target) {
  if (typeof relations?.[name] !== 'function') throw verificationError('CILV0003', `Missing verification relation: ${name}`);
  const result = relations[name](source, target);
  if (typeof result !== 'boolean') throw verificationError('CILV0006', `${name} must return a boolean`);
  return result;
}

export function isVerificationAssignable(source, target, relations) {
  if (sameVerificationType(source, target)) return true;
  // ECMA I.8.7.3 rule 4, carried into verifier assignment by III.1.8.1.2.3 rule 3.
  if (source.kind === VerificationKind.Int32 && target.kind === VerificationKind.NativeInt) return true;
  if (source.kind === VerificationKind.NativeInt && target.kind === VerificationKind.Int32) return true;
  if (source.kind === VerificationKind.Null && isReference(target)) return true;
  if (isReference(source) && isReference(target)) return relation(relations, 'isAssignableTo', source, target);
  if (!isManagedPointer(source) || !isManagedPointer(target)) return false;
  if (source.kind === VerificationKind.ReadonlyPointer && target.kind !== VerificationKind.ReadonlyPointer) return false;
  if (source.type === target.type) return true;
  return relation(relations, 'isPointerElementAssignableTo', source.type, target.type);
}

/** ECMA III.1.8.1.3 slot merge, incoming first and stored second. Reuses an operand when possible. */
export function mergeVerificationTypes(incoming, stored, relations) {
  requireVerificationType(incoming);
  requireVerificationType(stored);
  if (isVerificationAssignable(incoming, stored, relations)) return stored;
  if (isVerificationAssignable(stored, incoming, relations)) return incoming;
  if (!isReference(incoming) || !isReference(stored)) throw verificationError('CILV0002');
  if (typeof relations?.commonSupertype !== 'function') throw verificationError('CILV0003', 'Missing verification relation: commonSupertype');
  const merged = relations.commonSupertype(incoming, stored);
  requireVerificationType(merged, 'CILV0006');
  if (!isReference(merged) || !isVerificationAssignable(incoming, merged, relations) || !isVerificationAssignable(stored, merged, relations)) {
    throw verificationError('CILV0006', 'Common supertype must accept both reference operands');
  }
  return merged;
}

/** Merge equal-height stacks into an owned frozen array; at most 65,535 slots and cancellation before each slot. */
export function mergeVerificationStacks(incoming, stored, options = {}) {
  const { maxStack = 65535, signal, relations } = options;
  if (!Number.isInteger(maxStack) || maxStack < 0 || maxStack > 65535) throw verificationError('CILV0004');
  if (signal?.aborted) throw verificationError('CILV0005');
  if (!Array.isArray(incoming) || !Array.isArray(stored)) throw verificationError('CILV0001');
  if (incoming.length > maxStack || stored.length > maxStack) throw verificationError('CILV0004');
  if (incoming.length !== stored.length) throw verificationError('CILV0002', 'Verification stack heights differ');
  const merged = new Array(stored.length);
  for (let index = 0; index < stored.length; index++) {
    if (signal?.aborted) throw verificationError('CILV0005');
    merged[index] = mergeVerificationTypes(incoming[index], stored[index], relations);
  }
  return Object.freeze(merged);
}

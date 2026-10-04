import {normalizeCallType} from './generic-signatures.js';

const maxQueryInstructions = 4096;

/**
 * Metadata-only admission for static int Query<T...>() { return sizeof(...); }.
 * This shape needs closed layout metadata, never aggregate arguments, locals or
 * results. It does not replace ordinary signature, operand, constraint or stack
 * verification. Inspect every instruction, including unreachable suffixes.
 */
export function isSizeOfOnlyMethod(inspector, token) {
  if (!Number.isSafeInteger(token) || token >>> 24 !== 6 || !inspector.methods.has(token)) return false;
  const method = inspector.getMethod(token), signature = method.signature;
  if (!method.hasBody || method.implFlags & 0x1007 || method.flags & 0x2400 || !(method.flags & 0x10) ||
      !signature.isStatic || signature.callingConvention || signature.parameters.length ||
      normalizeCallType(signature.returnType) !== 'int' || method.locals.length || method.handlers.length ||
      method.instructions.length > maxQueryInstructions) return false;
  let position = 0;
  for (const instruction of method.instructions) {
    if (instruction.name === 'nop') continue;
    if (position === 0 && instruction.name === 'sizeof' || position === 1 && instruction.name === 'ret') position++;
    else return false;
  }
  return position === 2;
}

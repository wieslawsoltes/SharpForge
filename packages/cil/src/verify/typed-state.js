import { CilError } from '../binary.js';
import { mergeVerificationStacks } from './type-relations.js';
import { sameVerificationType } from './types.js';
import { primitiveRelations } from './typed-signatures.js';

const empty = Object.freeze([]);

function mergeStacks(incoming, stored, state, options) {
  if (incoming.length !== stored.length) state.fail('PathStackDepth');
  state.charge(stored.length);
  let merged;
  try {
    merged = mergeVerificationStacks(incoming, stored, {
      maxStack: state.method.maxStack, signal: options.signal, relations: primitiveRelations,
    });
  } catch (error) {
    if (error instanceof CilError && error.code === 'CILV0002') state.fail('PathStackUnexpected');
    throw error;
  }
  return merged.every((value, index) => sameVerificationType(value, stored[index])) ? stored : merged;
}

/** Internal state-composition seam over the existing bounded worklist and reusable transfer stack. */
export function createTypedFlowState(state, options) {
  return {
    entry: empty,
    restore(values) { state.restore(values); },
    snapshot() { return state.snapshot(); },
    merge(incoming, stored) { return mergeStacks(incoming, stored, state, options); },
  };
}

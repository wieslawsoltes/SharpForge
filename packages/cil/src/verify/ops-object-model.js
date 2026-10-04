import { VerificationKind as Kind, isReference } from './types.js';
import { isVerificationAssignable } from './type-relations.js';
import { prepareObjectType, prepareObjectConstructor } from './typed-object-model.js';

function prepareReferenceResult(instruction, state, context) {
  const target = prepareObjectType(instruction, state, context);
  if (target.byRefLike) state.fail('ByRefLikeObjectUnavailable', 'Ref-like object conversion requires a lifetime policy', true);
  return target;
}

function prepareBox(instruction, state, context) {
  if (prepareObjectType(instruction, state, context).byRefLike) state.fail('BoxByRef');
}

function prepareUnbox(instruction, state, context) {
  if (!prepareReferenceResult(instruction, state, context).isValue) state.fail('ValueTypeExpected');
}

export const objectModelTransfers = Object.freeze({
  newobj: Object.freeze({ operation: 'construct', metadata: true, prepare: prepareObjectConstructor }),
  castclass: Object.freeze({ operation: 'cast', metadata: true, prepare: prepareReferenceResult }),
  isinst: Object.freeze({ operation: 'cast', metadata: true, prepare: prepareReferenceResult }),
  box: Object.freeze({ operation: 'box', metadata: true, prepare: prepareBox }),
  unbox: Object.freeze({ operation: 'unbox', metadata: true, prepare: prepareUnbox }),
  'unbox.any': Object.freeze({ operation: 'unboxAny', metadata: true, prepare: prepareReferenceResult }),
});

function requireReference(state) {
  const value = state.pop();
  if (value.kind !== Kind.Null && !isReference(value)) state.fail('StackObjRef');
}

const actions = Object.freeze({
  construct(instruction, state) {
    const target = state.objectConstructors.get(instruction.operand);
    for (let index = target.parameters.length - 1; index >= 0; index--) {
      if (!isVerificationAssignable(state.pop(), target.parameters[index], state.relations)) state.fail('StackUnexpected');
    }
    state.push(target.result);
  },
  cast(instruction, state) {
    requireReference(state);
    state.push(state.objectTypes.get(instruction.operand).boxed);
  },
  box(instruction, state) {
    const target = state.objectTypes.get(instruction.operand);
    if (!isVerificationAssignable(state.pop(), target.value, state.relations)) state.fail('StackUnexpected');
    state.push(target.boxed);
  },
  unbox(instruction, state) {
    requireReference(state);
    state.push(state.objectTypes.get(instruction.operand).unboxed);
  },
  unboxAny(instruction, state) {
    requireReference(state);
    state.push(state.objectTypes.get(instruction.operand).value);
  },
});

/** Registered object policies share the existing stack, canonical relations and prepared operands. */
export function transferObjectModelInstruction(descriptor, instruction, state) {
  actions[descriptor.operation](instruction, state);
}

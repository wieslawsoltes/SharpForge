import { VerificationKind as Kind } from './types.js';
import { isVerificationAssignable } from './type-relations.js';
import { numericIndex, integerValue, numericResult, numericComparable } from './numeric-tables.js';
import { primitiveRelations } from './typed-signatures.js';

function assignable(source, target) {
  return isVerificationAssignable(source, target, primitiveRelations);
}

function requireNumeric(value, floating, state) {
  if (numericIndex(value) === undefined || (!floating && value.kind === Kind.Float))
    state.fail(floating ? 'ExpectedNumericType' : 'ExpectedIntegerType');
}

function storage(descriptor, instruction, state) {
  const slots = descriptor.argument ? state.signature.arguments : state.signature.locals;
  const index = descriptor.index ?? instruction.operand;
  if (!Number.isInteger(index) || index < 0 || index >= slots.length)
    state.fail(descriptor.argument ? 'UnrecognizedArgumentNumber' : 'UnrecognizedLocalNumber');
  if (!descriptor.argument && descriptor.operation !== 'store' && !state.method.initLocals) state.fail('InitLocals');
  return slots[index];
}

const handlers = Object.freeze({
  none() {},
  constant(descriptor, instruction, state) { state.push(descriptor.result); },
  load(descriptor, instruction, state) { state.push(storage(descriptor, instruction, state).value); },
  store(descriptor, instruction, state) {
    const target = storage(descriptor, instruction, state).value;
    if (!assignable(state.pop(), target)) state.fail('StackUnexpected');
  },
  address(descriptor, instruction, state) {
    const target = storage(descriptor, instruction, state);
    if (target.byref) state.fail('ByrefOfByref');
    state.push(target.address);
  },
  binary(descriptor, instruction, state) {
    const right = state.pop(), left = state.pop();
    const floating = descriptor.diagnostic === 'ExpectedNumericType';
    requireNumeric(right, floating, state);
    requireNumeric(left, floating, state);
    const result = numericResult(descriptor.table, left, right);
    if (!result) state.fail('StackUnexpected');
    state.push(result);
  },
  shift(descriptor, instruction, state) {
    const right = state.pop(), left = state.pop();
    if (right.kind !== Kind.Int32 && right.kind !== Kind.NativeInt) state.fail('StackUnexpected');
    requireNumeric(left, false, state);
    state.push(numericResult(descriptor.table, left, right));
  },
  unary(descriptor, instruction, state) {
    const value = state.pop();
    requireNumeric(value, descriptor.floating, state);
    state.push(value);
  },
  finite(descriptor, instruction, state) {
    const value = state.pop();
    if (value.kind !== Kind.Float) state.fail('StackUnexpected');
    state.push(value);
  },
  convert(descriptor, instruction, state) {
    requireNumeric(state.pop(), true, state);
    state.push(descriptor.result);
  },
  compare(descriptor, instruction, state) {
    const right = state.pop(), left = state.pop();
    if (!numericComparable(instruction.name, left, right)) state.fail('StackUnexpected');
    if (descriptor.result) state.push(descriptor.result);
  },
  duplicate(descriptor, instruction, state) {
    const value = state.pop();
    state.push(value);
    state.push(value);
  },
  discard(descriptor, instruction, state) { state.pop(); },
  condition(descriptor, instruction, state) {
    const value = state.pop();
    if (!integerValue(value) && ![Kind.Null, Kind.Object, Kind.ManagedPointer].includes(value.kind)) state.fail('StackUnexpected');
  },
  switch(descriptor, instruction, state) {
    if (state.pop().kind !== Kind.Int32) state.fail('StackUnexpected');
  },
  return(descriptor, instruction, state) {
    const expected = state.signature.result;
    if (expected === null) {
      if (state.length) state.fail('ReturnVoid');
    } else {
      if (!state.length) state.fail('ReturnMissing');
      if (state.length !== 1) state.fail('ReturnEmpty');
      if (!assignable(state.pop(), expected)) state.fail('StackUnexpected');
    }
    state.ended = true;
  },
});

/** Registered numeric transfers operate on one invocation-owned reusable stack; no instruction decoding occurs here. */
export function transferNumericInstruction(descriptor, instruction, state) {
  handlers[descriptor.operation](descriptor, instruction, state);
}

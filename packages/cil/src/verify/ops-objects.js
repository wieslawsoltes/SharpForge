import { VerificationKind as Kind } from './types.js';
import { isVerificationAssignable } from './type-relations.js';

const prepare = (instruction, state) => state.metadata.field(instruction.operand);

export const objectTransfers = Object.freeze({
  ldfld: Object.freeze({ operation: 'load', metadata: true, isStatic: false, prepare }),
  ldsfld: Object.freeze({ operation: 'load', metadata: true, isStatic: true, prepare }),
  stfld: Object.freeze({ operation: 'store', metadata: true, isStatic: false, prepare }),
  stsfld: Object.freeze({ operation: 'store', metadata: true, isStatic: true, prepare }),
  ldflda: Object.freeze({ operation: 'address', metadata: true, isStatic: false, prepare }),
  ldsflda: Object.freeze({ operation: 'address', metadata: true, isStatic: true, prepare }),
});

function receiverType(actual, field, operation, state) {
  if (actual.kind === Kind.Value && field.receiver.kind === Kind.ManagedPointer && actual.type === field.member.owner) {
    if (operation !== 'load') state.fail('ValueReceiverAddressUnavailable', 'Writing/addressing a value copy requires lifetime policy', true);
    return actual.type;
  }
  if (actual.kind === Kind.ReadonlyPointer && operation === 'load' && actual.type === field.member.owner) return actual.type;
  if (!isVerificationAssignable(actual, field.receiver, state.relations)) state.fail('StackUnexpected');
  return actual.kind === Kind.Null ? undefined : actual.type;
}

const actions = Object.freeze({
  load(field, value, state) { state.push(field.storage.value); },
  store(field, value, state) {
    if (field.member.flags & 0x20 && !state.metadata.canInitialize(field.member)) state.fail('InitOnly');
    if (!isVerificationAssignable(value, field.storage.value, state.relations)) state.fail('StackUnexpected');
  },
  address(field, value, state) {
    if (field.member.flags & 0x20) state.fail('InitOnly');
    state.push(field.storage.address);
  },
});

/** Field policies use canonical declarations, the shared stack and existing access/assignment relations. */
export function transferObjectInstruction(descriptor, instruction, state) {
  const field = state.metadata.field(instruction.operand);
  if (descriptor.isStatic && !field.member.isStatic) state.fail('ExpectedStaticField');
  const value = descriptor.operation === 'store' ? state.pop() : null;
  const receiver = descriptor.isStatic ? undefined : receiverType(state.pop(), field, descriptor.operation, state);
  state.metadata.access(field.member, receiver);
  actions[descriptor.operation](field, value, state);
}

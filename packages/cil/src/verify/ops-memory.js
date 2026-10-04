import { VerificationKind as Kind, isManagedPointer } from './types.js';
import { isVerificationAssignable } from './type-relations.js';
import { primitiveVerificationSlot } from './typed-signatures.js';

function addressSlot(address, writable, state) {
  if (!isManagedPointer(address)) state.fail('ExpectedByRef');
  if (writable && address.kind === Kind.ReadonlyPointer) state.fail('ReadOnlyIllegalWrite');
  const slot = primitiveVerificationSlot(address.type);
  if (!slot) state.fail('MemoryTypeUnavailable', 'Indirect access requires a resolved primitive storage type', true);
  return slot;
}

function referenceSlot(address, writable, state) {
  const slot = addressSlot(address, writable, state);
  if (slot.value.kind !== Kind.Object) state.fail('ExpectedReferenceType');
  return slot;
}

function numericSlot(descriptor, address, writable, state) {
  const target = addressSlot(address, writable, state);
  const operation = primitiveVerificationSlot(descriptor.storage);
  if (!isVerificationAssignable(target.value, operation.value, state.relations)) state.fail('StackUnexpected');
  if (!descriptor.elements.includes(target.type)) {
    state.fail('MemoryAccessShapeUnavailable',
      'Different storage widths require a memory-access consistency policy; equal intermediate stack kinds are insufficient', true);
  }
  return operation;
}

const handlers = Object.freeze({
  load(descriptor, instruction, state) {
    state.push(numericSlot(descriptor, state.pop(), false, state).value);
  },
  store(descriptor, instruction, state) {
    const value = state.pop();
    const target = numericSlot(descriptor, state.pop(), true, state);
    if (!isVerificationAssignable(value, target.value, state.relations)) state.fail('StackUnexpected');
  },
  loadReference(descriptor, instruction, state) {
    state.push(referenceSlot(state.pop(), false, state).value);
  },
  storeReference(descriptor, instruction, state) {
    const value = state.pop();
    const target = addressSlot(state.pop(), true, state);
    if (!isVerificationAssignable(value, target.value, state.relations)) state.fail('StackUnexpected');
    if (target.value.kind !== Kind.Object) {
      state.fail('MemoryAccessShapeUnavailable', 'stind.ref requires a resolved reference storage shape', true);
    }
  },
});

/** Indirect transfers reuse canonical storage slots and the invocation's stack and relations. */
export function transferMemoryInstruction(descriptor, instruction, state) {
  handlers[descriptor.operation](descriptor, instruction, state);
}

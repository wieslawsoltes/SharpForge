import { numericTransfers } from './numeric-tables.js';
import { transferNumericInstruction } from './ops-numeric.js';
import { objectTransfers, transferObjectInstruction } from './ops-objects.js';

function registerTransfers(contributions) {
  const entries = {};
  for (const [descriptors, transfer] of contributions) {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (Object.hasOwn(entries, name)) throw new Error(`Duplicate typed transfer: ${name}`);
      entries[name] = Object.freeze({ descriptor, transfer });
    }
  }
  return Object.freeze(entries);
}

/** Registered policies share one verifier and its invocation-owned stack/flow state. */
export const typedTransfers = registerTransfers([
  [numericTransfers, transferNumericInstruction], [objectTransfers, transferObjectInstruction],
]);

export function transferTypedInstruction(instruction, state) {
  const policy = typedTransfers[instruction.name];
  policy.transfer(policy.descriptor, instruction, state);
}

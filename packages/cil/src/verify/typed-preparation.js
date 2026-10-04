import { dataflowCancellation } from './dataflow.js';
import { typedTransfers } from './typed-transfers.js';

/** Only policies requesting preparation allocate this inspector-backed context or perform a second pass. */
export function prepareTypedInstructions(state, inspector, options) {
  if (!state.needsPreparation) return;
  const context = { inspector, options };
  for (const instruction of state.method.instructions) {
    dataflowCancellation(options.signal);
    const prepare = typedTransfers[instruction.name].descriptor.prepare;
    if (!prepare) continue;
    state.instruction = instruction;
    prepare(instruction, state, context);
  }
  state.instruction = null;
}

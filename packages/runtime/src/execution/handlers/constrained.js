import {ManagedFault} from '../../heap.js';

/** The verified adjacent call owns the constraint; no mutable prefix state survives a pause or unwind. */
export const handlers = new Map([
  ['constrained.', (vm, frame) => {
    if (frame.method.instructions[frame.pc]?.name !== 'callvirt') {
      throw new ManagedFault('InvalidProgramException', 'constrained. must immediately precede callvirt');
    }
  }]
]);

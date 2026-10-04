import {ManagedFault} from '../../heap.js';
import {prefixedOperation} from '../call-prefix.js';

/** The verified adjacent call owns the constraint; no mutable prefix state survives a pause or unwind. */
export const handlers = new Map([
  ['constrained.', (vm, frame) => {
    if (prefixedOperation(frame)?.name !== 'callvirt') {
      throw new ManagedFault('InvalidProgramException', 'constrained. must prefix callvirt');
    }
  }]
]);

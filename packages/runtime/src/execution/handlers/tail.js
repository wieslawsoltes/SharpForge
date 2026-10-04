import {
  jumpMethod
} from '../tailcall.js';

/** Prefix meaning is derived from the verified adjacent instruction, never mutable frame flags. */
export const handlers = new Map([
  ['tail.', () => {}],
  ['jmp', (vm, frame, instruction) => jumpMethod(vm, frame, instruction)]
]);

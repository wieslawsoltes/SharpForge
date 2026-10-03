import {registerFrame, releaseFrame} from './frame-lifetimes.js';
import {registerStackFrame, releaseStackFrame} from './stack-budget.js';

/** One admission boundary for byte budgets and pointer lifetime indexing. */
export function pushFrame(vm, frame) {
  registerStackFrame(vm, frame);
  try {
    registerFrame(vm, frame);
    vm.frames.push(frame);
  } catch (error) {
    releaseFrame(vm, frame);
    releaseStackFrame(vm, frame);
    throw error;
  }
  return frame;
}

/** Removal invalidates owned stack/pin leases and releases logical stack bytes. */
export function popFrame(vm) {
  const frame = vm.frames.pop();
  if (frame) {
    releaseFrame(vm, frame);
    releaseStackFrame(vm, frame);
  }
  return frame;
}

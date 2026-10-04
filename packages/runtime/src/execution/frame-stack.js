import {registerFrame, releaseFrame} from './frame-lifetimes.js';
import {registerStackFrame, releaseStackFrame, replaceStackFrame} from './stack-budget.js';
import {retirePooledFrame} from './frame-pool.js';

/** Verified methods use their metadata capacity; no per-push global limit check. */
export function pushStackValue(vm, value) {
  vm.top.stack.push(value);
}

/** One admission boundary for byte budgets and pointer lifetime indexing. */
export function pushFrame(vm, frame) {
  registerStackFrame(vm, frame);
  try {
    registerFrame(vm, frame);
    vm.frames.push(frame);
    if (vm.profiler) vm.profiler.enter(frame);
  } catch (error) {
    releaseFrame(vm, frame);
    releaseStackFrame(vm, frame);
    retirePooledFrame(vm, frame);
    throw error;
  }
  return frame;
}

/** Removal invalidates owned stack/pin leases and releases logical stack bytes. */
export function popFrame(vm) {
  const frame = vm.frames.pop();
  if (frame) {
    if (vm.profiler) vm.profiler.leave(frame);
    releaseFrame(vm, frame);
    releaseStackFrame(vm, frame);
    retirePooledFrame(vm, frame);
  }
  return frame;
}

/** Atomic budget admission ensures an oversized tail callee leaves its caller inspectable. */
export function replaceFrame(vm, frame) {
  const previous = vm.frames.at(-1);
  replaceStackFrame(vm, previous, frame);
  registerFrame(vm, frame);
  if (vm.profiler) vm.profiler.leave(previous);
  vm.frames[vm.frames.length - 1] = frame;
  if (vm.profiler) vm.profiler.enter(frame);
  releaseFrame(vm, previous);
  retirePooledFrame(vm, previous);
  return frame;
}

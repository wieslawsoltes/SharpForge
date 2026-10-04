import {
  registerFrame,
  releaseFrame
} from './frame-lifetimes.js';
import {
  reserveStackFrame,
  commitStackFrame,
  cancelStackFrame
} from './stack-budget.js';
import {
  popPooledFrame
} from './frame-retirement.js';
import {
  leaveCilMethod
} from './cil-method-events.js';
import {
  leaveSourceMethod
} from './source-runtime-events.js';
import {abandonObjectValue} from './object-value-state.js';

/** Admit a synthetic control frame without assigning pooled ownership to its shared slots. */
export function pushControlFrame(vm, frame) {
  const method = frame.method ?? vm.image.methods[frame.methodId];
  const ticket = reserveStackFrame(vm, method, frame.args?.length ?? 0);
  try {
    vm.frames.push(frame);
    registerFrame(vm, frame);
    commitStackFrame(ticket, frame);
    return frame;
  } catch (error) {
    if (vm.top === frame) vm.frames.pop();
    releaseFrame(vm, frame);
    cancelStackFrame(ticket);
    throw error;
  }
}

/** Method observations close only real calls; synthetic filter frames share the owner's method. */
export function retireExceptionFrame(vm, reason = 'exception') {
  const frame = vm.top;
  if (reason !== 'return') abandonObjectValue(vm, frame);
  if (!frame.filterSearch) {
    if (vm.inspector) leaveCilMethod(vm, frame, reason);
    else leaveSourceMethod(vm, frame, reason);
  }
  return popPooledFrame(vm);
}

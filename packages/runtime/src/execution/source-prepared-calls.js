import {sourceFrameCapability} from './source-frame-capability.js';
import {numericTypeId, numericTypeName} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {admitCallFrame} from './call-frames.js';
import {sourceTypedValue} from './source-value-storage.js';
import {framePool} from './frame-pool.js';
import {nextFrameId} from './frame-lifetimes.js';
import {reserveStackFrame, commitStackFrame, cancelStackFrame, releaseStackReservation} from './stack-budget.js';

const primitive = type => type === 'bool' || numericTypeName(type) === type && numericTypeId(type) !== undefined;

/** A fixed primitive frame needs no aggregate zero-initialization, optional packet or temporary argument buffer. */
export function prepareSourceCall(image, methodId, count) {
  const method = image.methods[methodId];
  if (!method?.isStatic || method.callingConvention === 5 || method.parameters.length !== count ||
      !method.locals.every(local => primitive(local.type)) || !method.parameters.every(parameter => primitive(parameter.type))) return null;
  const capacity = Math.max(method.locals.length, count);
  return Object.freeze({method, code: method.code, locals: method.locals, parameters: method.parameters,
    localCount: method.locals.length, methodId, count, capacity, frameCapability: sourceFrameCapability(image, methodId, capacity)});
}

/** Retain stack argument roots until the admitted frame owns them; failures preserve ordinary post-pop state. */
export function executePreparedSourceCall(vm, prepared) {
  if (!prepared) return false;
  const {method, methodId, count} = prepared;
  if (vm.image.methods[methodId] !== method || method.code !== prepared.code ||
      method.locals !== prepared.locals || method.parameters !== prepared.parameters ||
      method.locals.length !== prepared.localCount || method.parameters.length !== count) return false;
  const stack = vm.stack, base = stack.length - count;
  if (base < 0) throw new TypeError('Invalid call argument count');
  let ticket, pool, frame;
  try {
    if (vm.frames.length >= vm.options.maxFrames) {
      throw new ManagedFault('StackOverflowException', 'Maximum managed call depth exceeded');
    }
    ticket = reserveStackFrame(vm, method, prepared.capacity);
    pool = framePool(vm);
    frame = pool.acquireSource(prepared.frameCapability);
    frame.id = nextFrameId(vm);
    frame.methodId = methodId;
    frame.base = base;
    for (let index = 0; index < count; index++) {
      frame.locals[index] = sourceTypedValue(vm, stack[base + index], method.locals[index]?.type ?? method.parameters[index]?.type);
    }
    admitCallFrame(vm, frame);
    commitStackFrame(ticket, frame);
  } catch (error) {
    cancelStackFrame(ticket);
    if (frame) pool.retire(frame);
    throw error;
  } finally {
    try { stack.length = base; }
    finally { releaseStackReservation(ticket); }
  }
  return true;
}

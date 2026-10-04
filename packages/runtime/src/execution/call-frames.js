import {sourceTypedValue,initializeSourceValueLocals} from './source-value-storage.js';
import {appendSourceVarargs,prepareSourceVarargs} from './source-varargs.js';
import {sourceInputTypes} from './source-input-types.js';
import {attachVarargs} from './varargs.js';
import {admitCilStack} from './frame-stack.js';
import {reserveStackFrame, commitStackFrame, cancelStackFrame, releaseStackFrame, releaseStackReservation} from './stack-budget.js';
import {ManagedFault} from '../heap.js';
import {framePool} from './frame-pool.js';
import {methodOffsets} from './method-offsets.js';
import {storageDefault} from './storage.js';
import {initializeFloatFrame} from './typed-float-frame.js';
import {enterSourceMethod} from './source-runtime-events.js';
import {nextFrameId, registerFrame, releaseFrame} from './frame-lifetimes.js';

/** Admission is atomic with respect to the frame index, stack budget and pool. */
export function admitCallFrame(vm, frame) {
  vm.frames.push(frame);
  try {
    registerFrame(vm, frame);
  } catch (error) {
    vm.frames.pop();
    releaseFrame(vm, frame);
    releaseStackFrame(vm, frame);
    framePool(vm).retire(frame);
    throw error;
  }
}

/** Copy normalized arguments into owned storage; call scratch buffers never escape. */
export function cilCallFrame(vm, method, args, extra) {
  const capacity = admitCilStack(vm, method);
  const argumentCount = args.length + (extra?.optionalArguments?.length ?? 0);
  const ticket = reserveStackFrame(vm, method, argumentCount, extra?.optionalArguments);
  let pool, frame;
  try {
    pool = framePool(vm);
    frame = pool.acquire(method, argumentCount);
    frame.args.length = args.length;
    frame.id = nextFrameId(vm);
    frame.method = method;
    frame.offsets = methodOffsets(method);
    frame.needsInitialization = method.name !== '.cctor';
    const offset = method.signature.isStatic ? 0 : 1;
    if (offset) frame.args[0] = args[0];
    for (let index = offset; index < args.length; index++) {
      const type = method.signature.parameters[index - offset];
      frame.args[index] = type === undefined ? args[index] : vm.storage(args[index], type);
    }
    for (let index = 0; index < method.locals.length; index++) {
      frame.locals[index] = method.initLocals ? storageDefault(vm, method.locals[index]) : undefined;
    }
    Object.assign(frame, extra);
    const packet = attachVarargs(method, frame.args, extra?.optionalArguments);
    if (packet) frame.varargs = packet;
    delete frame.optionalArguments;
    initializeFloatFrame(vm, frame, capacity);
    commitStackFrame(ticket, frame);
    return frame;
  } catch (error) {
    cancelStackFrame(ticket);
    if (frame) pool.retire(frame);
    throw error;
  } finally {
    releaseStackReservation(ticket);
  }
}

/** Source frames reuse locals while retaining the existing shared evaluation stack. */
export function callSourceFrame(vm, methodId, args, extra = {}) {
  if (vm.frames.length >= vm.options.maxFrames) throw new ManagedFault('StackOverflowException', 'Maximum managed call depth exceeded');
  const method = vm.image.methods[methodId];
  if (!method || method.isAbstract) throw new ManagedFault('MissingMethodException', 'Cannot execute an abstract source method');
  if (!method.isStatic && args[0] === null) throw new ManagedFault('NullReferenceException', 'Cannot call an instance method on null');
  const fixed = method.parameters.length + (method.isStatic ? 0 : 1);
  const optional = method.callingConvention === 5 ? args.length - fixed : 0;
  if (optional < 0 || (!optional && args.length !== fixed)) {
    throw new ManagedFault('InvalidProgramException', 'Source method argument count mismatch');
  }
  const capacity = Math.max(args.length, method.locals.length + optional);
  const packet = prepareSourceVarargs(vm, method, args.length, extra.argumentTypes ?? [], fixed);
  const ticket = reserveStackFrame(vm, method, capacity, packet);
  let pool, frame, pinCount;
  try {
    pinCount = vm.heap.pins.length;
    vm.heap.pins.push(...args);
    pool = framePool(vm);
    frame = pool.acquire(method, capacity);
    frame.id = nextFrameId(vm);
    frame.methodId = methodId;
    frame.base = vm.stack.length;
    initializeSourceValueLocals(vm, frame, method, fixed);
    for (let index = 0; index < fixed; index++) {
      frame.locals[index] = sourceTypedValue(vm, args[index], method.locals[index]?.type ?? method.parameters[index]?.type);
    }
    Object.assign(frame, extra);
    appendSourceVarargs(vm, frame.locals, args, packet, fixed);
    if (packet) frame.varargs = packet;
    delete frame.argumentTypes;
    admitCallFrame(vm, frame);
    commitStackFrame(ticket, frame);
  } catch (error) {
    cancelStackFrame(ticket);
    if (frame) pool.retire(frame);
    throw error;
  } finally {
    try { if (pinCount !== undefined) vm.heap.pins.length = pinCount; }
    finally { releaseStackReservation(ticket); }
  }
  vm.profiler?.enter(frame);
  enterSourceMethod(vm, frame);
}

export function callSourceFromStack(vm, methodId, count) {
  const extra = vm.image.methods[methodId].callingConvention === 5 ? {argumentTypes: sourceInputTypes(vm).slice(-count)} : undefined;
  const pool = framePool(vm), args = pool.arguments(vm.stack, count);
  try { vm.call(methodId, args, extra); }
  finally { pool.releaseArguments(args); }
}

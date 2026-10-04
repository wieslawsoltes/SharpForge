import {admitCilStack} from './frame-stack.js';
import {reserveStackFrame, commitStackFrame, cancelStackFrame} from './stack-budget.js';
import {ManagedFault} from '../heap.js';
import {framePool} from './frame-pool.js';
import {methodOffsets} from './method-offsets.js';
import {storageDefault} from './storage.js';
import {copyFrameworkValue} from './framework-values.js';
import {initializeFloatFrame} from './typed-float-frame.js';

/** Copy normalized arguments into owned storage; call scratch buffers never escape. */
export function cilCallFrame(vm, method, args, extra) {
  const capacity = admitCilStack(vm, method);
  const ticket = reserveStackFrame(vm, method, args.length);
  let pool, frame;
  try {
    pool = framePool(vm);
    frame = pool.acquire(method, args.length);
    frame.id = ++vm.frameId;
    frame.method = method;
    frame.offsets = methodOffsets(method);
    frame.needsInitialization = method.name !== '.cctor';
    return vm.heap.withRoots(args, () => {
      const offset = method.signature.isStatic ? 0 : 1;
      if (offset) frame.args[0] = args[0];
      for (let index = offset; index < args.length; index++) {
        const type = method.signature.parameters[index - offset];
        frame.args[index] = type === undefined ? args[index] : vm.storage(args[index], type);
        vm.heap.pins.push(frame.args[index]);
      }
      for (let index = 0; index < method.locals.length; index++) {
        frame.locals[index] = method.initLocals ? storageDefault(vm, method.locals[index]) : undefined;
        vm.heap.pins.push(frame.locals[index]);
      }
      Object.assign(frame, extra);
      initializeFloatFrame(vm, frame, capacity);
      commitStackFrame(ticket, frame);
      return frame;
    });
  } catch (error) {
    cancelStackFrame(ticket);
    if (frame) pool.retire(frame);
    throw error;
  }
}

/** Source frames reuse locals while retaining the existing shared evaluation stack. */
export function callSourceFrame(vm, methodId, args) {
  vm.platform?.ui?.bindingServices?.events.beforeCall(methodId, args);
  if (vm.frames.length >= vm.options.maxFrames) throw new ManagedFault('StackOverflowException', 'Maximum managed call depth exceeded');
  const method = vm.image.methods[methodId];
  if (!method.isStatic && args[0] === null) throw new ManagedFault('NullReferenceException', 'Cannot call an instance method on null');
  const ticket = reserveStackFrame(vm, method, args.length);
  let pool, frame;
  try {
    pool = framePool(vm);
    frame = pool.acquire(method, args.length);
    frame.id = ++vm.frameId;
    frame.methodId = methodId;
    frame.base = vm.stack.length;
    vm.heap.withRoots(args, () => {
      for (let index = 0; index < args.length; index++) {
        frame.locals[index] = copyFrameworkValue(vm, args[index], method.locals[index]?.type);
        vm.heap.pins.push(frame.locals[index]);
      }
      vm.frames.push(frame);
      commitStackFrame(ticket, frame);
    });
  } catch (error) {
    cancelStackFrame(ticket);
    if (frame) pool.retire(frame);
    throw error;
  }
  vm.profiler?.enter(frame);
}

export function callSourceFromStack(vm, methodId, count) {
  const pool = framePool(vm), args = pool.arguments(vm.stack, count);
  try { vm.call(methodId, args); }
  finally { pool.releaseArguments(args); }
}

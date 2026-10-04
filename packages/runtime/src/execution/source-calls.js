import {appendSourceVarargs} from './source-varargs.js';
import {validatePointer, pointerType, asReadonly} from './managed-pointers.js';
import {ManagedFault} from '../heap.js';
import {sourceStore} from './source-storage.js';
import {pushFrame} from './frame-stack.js';
import {framePool} from './frame-pool.js';
import {sourceInputTypes} from './source-storage.js';

/** Source arguments use the same budget and frame lifetime boundary as CIL. */
export function callSource(vm, methodId, args, types = []) {
  if (vm.options.maxFrames !== undefined && vm.frames.length >= vm.options.maxFrames) {
    const fault = new ManagedFault('StackOverflowException', 'Explicit managed frame limit exceeded');
    fault.fatal = true;
    fault.runtimeOrigin = true;
    throw fault;
  }
  const method = vm.image.methods[methodId];
  const fixed = method.parameters.length + (method.isStatic ? 0 : 1);
  const pool = framePool(vm), frame = pool.acquire(method, Math.max(0, args.length - fixed)), locals = frame.locals;
  locals.length = method.locals.length;
  try { vm.heap.withRoots(args, () => {
    for (let index = 0; index < Math.min(args.length, fixed); index++) {
      let argument = args[index];
      const type = method.locals[index].type;
      if(type.endsWith('&')) {
        const parameter = method.parameters[index - (method.isStatic ? 0 : 1)];
        const readOnly = ['in', 'ref readonly', 'ref readonly parameter'].includes(parameter?.refKind);
        validatePointer(vm,argument,{write:!readOnly,allowUninitialized:parameter?.refKind==='out'});
        if(pointerType(vm,argument)!==vm.heap.methodTables.get(type.slice(0,-1))) {
          throw new ManagedFault('InvalidProgramException','Managed reference argument type mismatch');
        }
        if(readOnly)argument=asReadonly(vm,argument);
      }
      locals[index] = sourceStore(vm, argument, type, types[index]);
      vm.heap.pins.push(locals[index]);
    }
    if (!method.isStatic && args[0] === null) {
      throw new ManagedFault('NullReferenceException', 'Cannot call an instance method on null');
    }
    frame.varargs = appendSourceVarargs(vm, method, locals, args, types, fixed) ?? undefined;
    frame.id = ++vm.frameId;
    frame.methodId = methodId;
    frame.pc = 0;
    frame.base = vm.stack.length;
    frame.point = null;
    frame.exception = frame.pending = null;
    pushFrame(vm, frame);
  }); } catch (error) { pool.retire(frame); throw error; }
}

/** Source call arguments borrow a temporary buffer; the callee owns its copied local slots. */
export function callSourceFromStack(vm, methodId, count) {
  const pool = framePool(vm), input = sourceInputTypes(vm);
  const args = pool.arguments(vm.stack, count);
  const types = pool.arguments(input, count, false);
  try { callSource(vm, methodId, args, types); }
  finally { pool.releaseArguments(types); pool.releaseArguments(args); }
}

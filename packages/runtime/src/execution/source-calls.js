import {validatePointer, pointerType, asReadonly} from './managed-pointers.js';
import {ManagedFault} from '../heap.js';
import {sourceStore} from './source-storage.js';
import {frameState} from './source-eh.js';
import {pushFrame} from './frame-stack.js';

/** Source arguments use the same budget and frame lifetime boundary as CIL. */
export function callSource(vm, methodId, args, types = []) {
  if (vm.options.maxFrames !== undefined && vm.frames.length >= vm.options.maxFrames) {
    const fault = new ManagedFault('StackOverflowException', 'Explicit managed frame limit exceeded');
    fault.fatal = true;
    fault.runtimeOrigin = true;
    throw fault;
  }
  const method = vm.image.methods[methodId];
  const locals = Array(method.locals.length).fill(undefined);
  vm.heap.withRoots(args, () => {
    for (let index = 0; index < args.length; index++) {
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
    pushFrame(vm, {
      id: ++vm.frameId,
      methodId,
      pc: 0,
      base: vm.stack.length,
      locals,
      point: null,
      ...frameState()
    });
  });
}

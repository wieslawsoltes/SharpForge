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
      locals[index] = sourceStore(vm, args[index], method.locals[index].type, types[index]);
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

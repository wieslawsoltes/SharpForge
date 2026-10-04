import {sourceTypedValue} from './source-value-storage.js';
import {popPooledFrame} from './frame-retirement.js';

/** Shared terminal delivery after frame retirement and any managed return continuation. */
export function deliverSourceReturn(vm, value) {
  if (vm.frames.length) vm.stack.push(value);
  else {
    vm.returnValue = value;
    vm.state = 'terminated';
    vm.exitCode = typeof value === 'number' ? value | 0 : 0;
  }
}

/** Selected only by unobserved source blocks without handlers, finally work or managed continuations. */
export function returnSourceBlock(vm, frame) {
  const value = sourceTypedValue(vm, vm.stack.pop(), vm.image.methods[frame.methodId].returnType);
  vm.stack.length = frame.base;
  popPooledFrame(vm);
  deliverSourceReturn(vm, value);
}

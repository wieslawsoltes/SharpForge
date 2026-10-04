import {Op} from '@sharpforge/bytecode';
import {SUSPENDED} from '../../platform.js';
import {callSourceFromStack} from '../call-frames.js';

/** Call scratch storage, suspension identity and delegate roots retain their owners. */
export const sourceCallHandlers = Object.freeze({
  [Op.CALL](vm,frame,a,b) {
    callSourceFromStack(vm,a,b);
  },
  [Op.BUILTIN](vm,frame,a,b) {
    const args=vm.stack.splice(vm.stack.length-b,b),value=vm.builtin(a,args);
    if(value!==SUSPENDED)vm.stack.push(value);
  },
  [Op.DELEGATE](vm,frame,a,b) {
    const receiver=vm.stack.pop();
    vm.stack.push(vm.heap.withRoots([receiver],()=>vm.platform.delegate(vm.image.constants[b],a,receiver)));
  }
});

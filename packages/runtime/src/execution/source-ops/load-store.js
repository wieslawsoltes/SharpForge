import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';

/** Source stores retain their assigned value on the shared evaluation stack. */
export const sourceLoadStoreHandlers = Object.freeze({
  [Op.CONST](vm,frame,a) {
    vm.stack.push(vm.constant(a));
  },
  [Op.LDLOC](vm,frame,a) {
    if(frame.locals[a]===undefined)throw new ManagedFault('InvalidProgramException','Read of uninitialized local');
    vm.stack.push(frame.locals[a]);
  },
  [Op.STLOC](vm,frame,a) {
    const oldValue=frame.locals[a];
    frame.locals[a]=vm.stack.at(-1);
    vm.notifyWrite({kind:'local',frameId:frame.id,index:a,value:frame.locals[a],oldValue});
  },
  [Op.LDSTATIC](vm,frame,a) {
    vm.stack.push(vm.statics[a]);
  },
  [Op.STSTATIC](vm,frame,a) {
    const oldValue=vm.statics[a];
    vm.statics[a]=vm.stack.at(-1);
    vm.notifyWrite({kind:'static',index:a,value:vm.statics[a],oldValue});
  },
  [Op.DUP](vm) {
    vm.stack.push(vm.stack.at(-1));
  },
  [Op.POP](vm) {
    vm.stack.pop();
  }
});

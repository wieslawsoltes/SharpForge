import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';
import {rethrow} from '../source-eh.js';

/** Sequence pauses and instruction accounting remain in the VM slice loop. */
export const sourceControlHandlers = Object.freeze({
  [Op.SEQ]() {},
  [Op.NOP]() {},
  [Op.ENDFINALLY](vm,frame) {
    vm.resumeUnwind(frame);
  },
  [Op.JUMP](vm,frame,a) {
    vm.transfer(frame,'jump',a);
  },
  [Op.JFALSE](vm,frame,a) {
    if(!vm.stack.pop())vm.transfer(frame,'jump',a);
  },
  [Op.JTRUE](vm,frame,a) {
    if(vm.stack.pop())vm.transfer(frame,'jump',a);
  },
  [Op.RET](vm,frame) {
    const result=vm.stack.pop();
    vm.transfer(frame,'return',Infinity,result);
  },
  [Op.THROW](vm) {
    const ref=vm.stack.pop();
    if(ref===null)throw new ManagedFault('NullReferenceException','A null exception was thrown');
    const record=vm.heap.get(ref);
    throw new ManagedFault(record.type,vm.format(record.data[0]),ref);
  },
  [Op.RETHROW](vm,frame) {
    rethrow(frame);
  }
});

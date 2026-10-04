import {sourceTypedValue} from '../source-value-storage.js';
import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';
import {rethrow, endSourceFilter} from '../source-eh.js';
import {faultFromException} from '../exception-object.js';

/** Sequence pauses and instruction accounting remain in the VM slice loop. */
export const sourceControlHandlers = Object.freeze({
  [Op.SEQ]() {},
  [Op.NOP]() {},
  [Op.ENDFILTER](vm) {
    endSourceFilter(vm, vm.stack.pop());
  },
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
    const result=sourceTypedValue(vm,vm.stack.pop(),vm.image.methods[frame.methodId].returnType);
    vm.transfer(frame,'return',Infinity,result);
  },
  [Op.THROW](vm) {
    throw faultFromException(vm, vm.stack.pop());
  },
  [Op.RETHROW](vm,frame) {
    rethrow(frame);
  }
});

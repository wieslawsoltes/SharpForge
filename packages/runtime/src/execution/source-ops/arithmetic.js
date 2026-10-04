import {Op,BinaryName,UnaryName} from '@sharpforge/bytecode';
import {convert,unary,sourceEnum} from '../source-ops.js';

/** Keep declared numeric modes and the existing source arithmetic helpers intact. */
export const sourceArithmeticHandlers = Object.freeze({
  [Op.ENUM](vm,frame,a,b) {
    vm.stack.push(sourceEnum(vm,a,b));
  },
  [Op.BINARY](vm,frame,a,b) {
    const right=vm.stack.pop(),left=vm.stack.pop();
    vm.stack.push(vm.binary(BinaryName[a],left,right,b));
  },
  [Op.CONVERT](vm,frame,a,b) {
    vm.stack.push(convert(vm.stack.pop(),a,b,vm));
  },
  [Op.UNARY](vm,frame,a,b) {
    vm.stack.push(unary(UnaryName[a],vm.stack.pop(),b,vm));
  }
});

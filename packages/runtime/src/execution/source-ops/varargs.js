import {
  Op
} from '@sharpforge/bytecode';
import {
  executeSourceVarargs
} from '../source-varargs.js';

/** CLI argument packets and typed references remain ordinary interpreter operations. */
export const sourceVarargsHandlers = Object.freeze(Object.fromEntries(
  [Op.ARGLIST, Op.MKREFANY, Op.REFANYVAL, Op.REFANYTYPE].map(op => [op, (vm, frame, a) => executeSourceVarargs(vm, frame, op, a)])));

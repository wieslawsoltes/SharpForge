import {Op} from '@sharpforge/bytecode';
import {sourceOpcodeHandlers} from './source-ops/index.js';
import {sourceLoadStoreHandlers} from './source-ops/load-store.js';
import {sourceArithmeticHandlers} from './source-ops/arithmetic.js';
import {returnSourceBlock} from './source-return.js';
import {executePreparedSourceCall} from './source-prepared-calls.js';
import {sourceCallHandlers} from './source-ops/call.js';
import {executeSourceInteger, sourceIntegerFallback} from './source-fusion-numerics.js';

/** A decoded block preserves every faulting PC and stack effect; frame changes occur only at its last instruction. */
export function executeSourceBlock(vm, frame, group, length) {
  const stack = vm.stack;
  for (let index = 0; index < length; index++) {
    const instruction = group.instructions[index];
    const {opcode, first, second} = instruction;
    frame.pc++;
    vm.instructions++;
    switch (opcode) {
      case Op.SEQ:
        frame.point = vm.image.sequencePoints[first];
        vm.currentPoint = frame.point;
        break;
      case Op.NOP: break;
      case Op.CONST: sourceLoadStoreHandlers[Op.CONST](vm, frame, first); break;
      case Op.LDLOC: sourceLoadStoreHandlers[Op.LDLOC](vm, frame, first); break;
      case Op.STLOC: sourceLoadStoreHandlers[Op.STLOC](vm, frame, first); break;
      case Op.POP: stack.pop(); break;
      case Op.DUP: stack.push(stack.at(-1)); break;
      case Op.BINARY: {
        if (!instruction.integer) {
          sourceArithmeticHandlers[Op.BINARY](vm, frame, first, second);
          break;
        }
        const right = stack.pop(), left = stack.pop();
        const result = executeSourceInteger(vm, instruction.integer, left, right);
        if (result === sourceIntegerFallback) {
          stack.push(left, right);
          sourceArithmeticHandlers[Op.BINARY](vm, frame, first, second);
        } else stack.push(result);
        break;
      }
      case Op.JUMP: frame.pc = first; break;
      case Op.JTRUE: if (stack.pop()) frame.pc = first; break;
      case Op.JFALSE: if (!stack.pop()) frame.pc = first; break;
      case Op.CALL:
        if (!executePreparedSourceCall(vm, instruction.call)) {
          sourceCallHandlers[Op.CALL](vm, frame, first, second);
          return false;
        }
        break;
      case Op.RET: returnSourceBlock(vm, frame); break;
      default: sourceOpcodeHandlers[opcode](vm, frame, first, second);
    }
  }
  return true;
}

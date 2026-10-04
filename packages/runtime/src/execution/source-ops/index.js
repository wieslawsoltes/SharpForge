import {sourceNullableHandlers} from './nullable.js';
import {Op} from '@sharpforge/bytecode';
import {sourceLoadStoreHandlers} from './load-store.js';
import {sourceArithmeticHandlers} from './arithmetic.js';
import {sourceControlHandlers} from './control.js';
import {sourceCallHandlers} from './call.js';
import {sourceObjectHandlers} from './object.js';
import {sourceMemoryHandlers} from './memory.js';
import {sourceAddressHandlers} from './addresses.js';
import {sourceUnsafeMemoryHandlers} from './unsafe-memory.js';
import {sourceVarargsHandlers} from './varargs.js';

/** Dense, immutable dispatch for the released source opcode IDs; the VM owns unknown-op faults. */
export const sourceOpcodeHandlers = Object.freeze(Object.assign([],
  sourceLoadStoreHandlers,
  sourceArithmeticHandlers,
  sourceControlHandlers,
  sourceCallHandlers,
  sourceObjectHandlers,
  sourceMemoryHandlers,
  sourceAddressHandlers,
  sourceUnsafeMemoryHandlers,
  sourceVarargsHandlers,
  sourceNullableHandlers
));

/** Fixed call sites let each grouped handler specialize without a polymorphic call per instruction. */
export function dispatchSourceOpcode(vm,frame,op,a,b) {
  switch(op) {
    case Op.SEQ: sourceOpcodeHandlers[Op.SEQ](vm,frame,a,b); return true;
    case Op.CONST: sourceOpcodeHandlers[Op.CONST](vm,frame,a,b); return true;
    case Op.LDLOC: sourceOpcodeHandlers[Op.LDLOC](vm,frame,a,b); return true;
    case Op.STLOC: sourceOpcodeHandlers[Op.STLOC](vm,frame,a,b); return true;
    case Op.LDSTATIC: sourceOpcodeHandlers[Op.LDSTATIC](vm,frame,a,b); return true;
    case Op.STSTATIC: sourceOpcodeHandlers[Op.STSTATIC](vm,frame,a,b); return true;
    case Op.LDFLD: sourceOpcodeHandlers[Op.LDFLD](vm,frame,a,b); return true;
    case Op.STFLD: sourceOpcodeHandlers[Op.STFLD](vm,frame,a,b); return true;
    case Op.DUP: sourceOpcodeHandlers[Op.DUP](vm,frame,a,b); return true;
    case Op.POP: sourceOpcodeHandlers[Op.POP](vm,frame,a,b); return true;
    case Op.BINARY: sourceOpcodeHandlers[Op.BINARY](vm,frame,a,b); return true;
    case Op.UNARY: sourceOpcodeHandlers[Op.UNARY](vm,frame,a,b); return true;
    case Op.JUMP: sourceOpcodeHandlers[Op.JUMP](vm,frame,a,b); return true;
    case Op.JFALSE: sourceOpcodeHandlers[Op.JFALSE](vm,frame,a,b); return true;
    case Op.JTRUE: sourceOpcodeHandlers[Op.JTRUE](vm,frame,a,b); return true;
    case Op.CALL: sourceOpcodeHandlers[Op.CALL](vm,frame,a,b); return true;
    case Op.BUILTIN: sourceOpcodeHandlers[Op.BUILTIN](vm,frame,a,b); return true;
    case Op.RET: sourceOpcodeHandlers[Op.RET](vm,frame,a,b); return true;
    case Op.NEWOBJ: sourceOpcodeHandlers[Op.NEWOBJ](vm,frame,a,b); return true;
    case Op.NEWARR: sourceOpcodeHandlers[Op.NEWARR](vm,frame,a,b); return true;
    case Op.LDELEM: sourceOpcodeHandlers[Op.LDELEM](vm,frame,a,b); return true;
    case Op.STELEM: sourceOpcodeHandlers[Op.STELEM](vm,frame,a,b); return true;
    case Op.LENGTH: sourceOpcodeHandlers[Op.LENGTH](vm,frame,a,b); return true;
    case Op.THROW: sourceOpcodeHandlers[Op.THROW](vm,frame,a,b); return true;
    case Op.RETHROW: sourceOpcodeHandlers[Op.RETHROW](vm,frame,a,b); return true;
    case Op.CONVERT: sourceOpcodeHandlers[Op.CONVERT](vm,frame,a,b); return true;
    case Op.NOP: sourceOpcodeHandlers[Op.NOP](vm,frame,a,b); return true;
    case Op.ENDFINALLY: sourceOpcodeHandlers[Op.ENDFINALLY](vm,frame,a,b); return true;
    case Op.DELEGATE: sourceOpcodeHandlers[Op.DELEGATE](vm,frame,a,b); return true;
    case Op.ENUM: sourceOpcodeHandlers[Op.ENUM](vm,frame,a,b); return true;
    default: {
      if (!Number.isInteger(op) || !Object.hasOwn(sourceOpcodeHandlers, op)) return false;
      const handler = sourceOpcodeHandlers[op];
      if (!handler) return false;
      handler(vm, frame, a, b);
      return true;
    }
  }
}

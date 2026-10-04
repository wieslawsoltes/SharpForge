import {CilOpcodes} from '@sharpforge/cil';
import {ManagedFault} from './managed-fault.js';

/** Unknown CIL is malformed; recognized opcodes without a runtime adapter are unsupported. */
export function rejectCilOpcode(name) {
  const known = Object.hasOwn(CilOpcodes, name);
  throw new ManagedFault(known ? 'NotSupportedException' : 'InvalidProgramException',
    known ? `Opcode '${name}' is not executable` : `Unknown CIL opcode '${name}'`);
}

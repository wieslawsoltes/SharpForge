import {sourceLoadStoreHandlers} from './load-store.js';
import {sourceArithmeticHandlers} from './arithmetic.js';
import {sourceControlHandlers} from './control.js';
import {sourceCallHandlers} from './call.js';
import {sourceObjectHandlers} from './object.js';

/** Dense, immutable dispatch for the released source opcode IDs; the VM owns unknown-op faults. */
export const sourceOpcodeHandlers = Object.freeze(Object.assign([],
  sourceLoadStoreHandlers,
  sourceArithmeticHandlers,
  sourceControlHandlers,
  sourceCallHandlers,
  sourceObjectHandlers
));

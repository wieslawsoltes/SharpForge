import { signaturePrimitiveNodes } from '../metadata/signature-types.js';
import { primitiveVerificationSlot } from './typed-signatures.js';
import { prepareStringLiteral } from './typed-literals.js';

const string = primitiveVerificationSlot(signaturePrimitiveNodes.string).value;
export const literalTransfers = Object.freeze({ ldstr: Object.freeze({ prepare: prepareStringLiteral }) });

/** A prepared literal uses the existing canonical primitive String verification value. */
export function transferLiteralInstruction(descriptor, instruction, state) {
  state.push(string);
}

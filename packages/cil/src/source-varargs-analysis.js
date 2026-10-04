import {
  Op
} from '@sharpforge/bytecode';
import {
  CilError
} from './binary.js';
import {
  normalizeCallType
} from './call-profile.js';

/** Typed references retain exact declared identities during source stack analysis. */
export function transferSourceVarargs({
  op,
  a,
  stack,
  pop,
  image
}) {
  if (op === Op.ARGLIST) stack.push('System.RuntimeArgumentHandle');
  else if (op === Op.MKREFANY) {
    if (normalizeCallType(pop()) !== normalizeCallType(image.constants[a] + '&'))
      throw new CilError('Typed-reference operand must have the exact addressed type');
    stack.push('typedref');
  } else if (op === Op.REFANYVAL || op === Op.REFANYTYPE) {
    if (!['typedref', 'System.TypedReference'].includes(pop())) throw new CilError('Expected a typed reference');
    stack.push(op === Op.REFANYVAL ? image.constants[a] + '&' : 'System.Type');
  } else return false;
  return true;
}

import {sourceCallArity} from './source-call-arity.js';
import {Op} from './opcodes.js';

const invalid = (need, delta, valid, message) => ({need, delta, error: valid ? null : message});

function addressEffect(flags, index, {image, method}) {
  const kind = flags & 255;
  let valid = flags >= 0 && (flags & ~511) === 0 && kind <= 5 && Number.isInteger(index) && index >= 0;
  if (kind <= 1) valid &&= index < method.locals.length;
  if (kind === 2) valid &&= index < image.statics.length;
  if (kind === 3) valid &&= typeof image.constants[index] === 'string';
  if (kind === 5) valid &&= !!(flags & 256) && index === 0;
  const need = kind === 3 ? 2 : kind >= 4 ? 1 : 0;
  return invalid(need, 1 - need, valid, 'Invalid source managed address');
}

/** Stack and structural rules for appended control opcodes; unknown operations return null. */
export function controlStackEffect(op, a, b, context) {
  if (op === Op.CALLVIRT) {
    const method = context.image.methods[a];
    return invalid(b, 1 - b, method && !method.isStatic && sourceCallArity(method, b), 'Invalid virtual call target or argument count');
  }
  if (op === Op.ADDRESS) return addressEffect(a, b, context);
  if (op === Op.LDIND || op === Op.STIND) {
    const valid = b === 0 && (a === -1 || typeof context.image.constants[a] === 'string');
    return invalid(op === Op.LDIND ? 1 : 2, op === Op.LDIND ? 0 : -1, valid, 'Invalid indirect storage type');
  }
  if (op === Op.ARGLIST) {
    return invalid(0, 1, a === 0 && b === 0 && context.method.callingConvention === 5, 'arglist requires a vararg method');
  }
  if (op === Op.REFANYTYPE) return invalid(1, 0, a === 0 && b === 0, 'Invalid typed-reference type operation');
  if (op === Op.MKREFANY || op === Op.REFANYVAL) {
    const type = context.image.constants[a];
    const valid = typeof type === 'string' && type.length > 0 && !type.endsWith('&') &&
      !['void', 'System.Void', 'typedref', 'System.TypedReference'].includes(type) && b === 0;
    return invalid(1, 0, valid, 'Invalid typed-reference operand type');
  }
  return null;
}

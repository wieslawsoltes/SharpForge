import {Op} from './opcodes.js';

export function varargsStackEffect(op, a, b, image, method) {
  if (op === Op.ARGLIST) return {need: 0, delta: 1, valid: a === 0 && b === 0 && method.callingConvention === 5};
  if (op === Op.REFANYTYPE) return {need: 1, delta: 0, valid: a === 0 && b === 0};
  if (op !== Op.MKREFANY && op !== Op.REFANYVAL) return null;
  const type = image.constants[a];
  return {need: 1, delta: 0, valid: typeof type === 'string' && type.length > 0 &&
    !['void', 'System.Void', 'typedref', 'System.TypedReference'].includes(type) && !type.endsWith('&') && b === 0};
}

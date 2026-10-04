import {Op} from './opcodes.js';

const effect = (need, delta, valid, error) => ({need, delta, error: valid ? null : error});
const pinnedLocal = (method, index) => Number.isInteger(index) && index >= 0 && method?.locals[index]?.pinned === true &&
  typeof method.locals[index].type === 'string' && method.locals[index].type.endsWith('&');

/** Unsafe source instructions can only name validated element constants and declared lexical pin slots. */
export function unsafeMemoryStackEffect(op, a, b, {image, method}) {
  const type = Number.isInteger(a) && a >= 0 && typeof image.constants[a] === 'string' && image.constants[a].length > 0;
  if (op === Op.PIN) return effect(1, 0, type && pinnedLocal(method, b), 'Invalid lexical pin declaration');
  if (op === Op.UNPIN) return effect(0, 1, b === 0 && pinnedLocal(method, a), 'Invalid lexical pin release');
  if (op === Op.PTRCONVERT || op === Op.STACKALLOC_RAW) {
    return effect(1, 0, type && b === 0, 'Invalid native pointer element type');
  }
  if (op === Op.SIZEOF) return effect(0, 1, type && b === 0, 'Invalid sizeof element type');
  return null;
}

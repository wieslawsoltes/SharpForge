import {Op} from './opcodes.js';
import {unsafeMemoryStackEffect} from './unsafe-memory-stack-effect.js';

const result = (need, delta, valid, error) => ({need, delta, error: valid ? null : error});
const rank = value => Number.isInteger(value) && value >= 1 && value <= 32;
const typeConstant = (image, index) => typeof image.constants[index] === 'string' && image.constants[index].length > 0;

/** Structural stack effects for appended memory IDs; the CIL analysis phase validates element types. */
export function memoryStackEffect(op, a, b, context) {
  const {image} = context;
  if (op === Op.NEWRECT) return result(b, 1 - b, rank(b) && typeConstant(image, a), 'Invalid rectangular allocation');
  if (op === Op.LDRECT || op === Op.RECTADDR) return result(a + 1, -a, rank(a) && b === 0, 'Invalid rectangular element rank');
  if (op === Op.STRECT) return result(a + 2, -a - 1, rank(a) && b === 0, 'Invalid rectangular store rank');
  if (op === Op.STACKALLOC) return result(1, 0, b === 0 && typeConstant(image, a), 'Invalid stack allocation element');
  if (op === Op.SPANDEFAULT) return result(0, 1, b === 0 && typeConstant(image, a), 'Invalid Span default type');
  if (op === Op.SPANSLICE) return result(b + 1, -b, a === 0 && (b === 1 || b === 2), 'Invalid Span slice arity');
  if (op === Op.SPANGET || op === Op.SPANADDR) return result(2, -1, a === 0 && b === 0, 'Invalid Span element operation');
  if (op === Op.SPANSET) return result(3, -2, a === 0 && b === 0, 'Invalid Span store operation');
  if (op === Op.SPANLENGTH || op === Op.SPANREADONLY) return result(1, 0, a === 0 && b === 0, 'Invalid Span operation');
  return unsafeMemoryStackEffect(op, a, b, context);
}

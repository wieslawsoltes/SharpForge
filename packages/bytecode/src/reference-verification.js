import {Op} from './opcodes.js';

/** Structural checks for the append-only managed-location bytecode family. */
export function referenceStackEffect(op, a, b, image, method) {
  if (op === Op.ADDRESS) {
    const kind = a & 3, forwarding = !!(a & 8);
    const local = method.locals[b];
    const valid = a >= 0 && a <= 15 && b >= 0 && (!forwarding || kind === 0 && local?.type.endsWith('&')) &&
      (kind !== 0 || !!local) && (kind !== 1 || !!image.statics[b]) && (kind !== 3 || b === 0);
    const need = kind === 2 ? 1 : kind === 3 ? 2 : 0;
    return {need, delta: 1 - need, valid};
  }
  if (op !== Op.LDIND && op !== Op.STIND) return null;
  const type = image.constants[a];
  return {need: op === Op.LDIND ? 1 : 2, delta: op === Op.LDIND ? 0 : -1,
    valid: b === 0 && typeof type === 'string' && type.length > 0 && type !== 'void' && !type.endsWith('&')};
}

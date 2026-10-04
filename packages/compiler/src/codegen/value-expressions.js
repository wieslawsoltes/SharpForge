import {
  Op
} from '@sharpforge/bytecode';

/** Explicit value conversions retain their declared type independently of storage destinations. */
export function emitValueExpression(emitter, node) {
  if (node.kind !== 'BoxValue' && node.kind !== 'UnboxValue') return false;
  emitter.expr(node.operand);
  emitter.emit(node.kind === 'BoxValue' ? Op.BOX : Op.UNBOXANY,
    emitter.c.constant(node.valueType ?? node.legacyType));
  return true;
}

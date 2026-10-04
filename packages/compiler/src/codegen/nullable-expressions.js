import {Op, sourceNullableElement} from '@sharpforge/bytecode';

export function emitNullableExpression(emitter, node) {
  if (node.kind !== 'NullableOperation') return false;
  if (node.operand) emitter.expr(node.operand);
  if (node.fallback) emitter.expr(node.fallback);
  emitter.emit(Op.NULLABLE, emitter.c.constant(node.owner), node.mode);
  return true;
}

export function emitNullableDefault(emitter, type) {
  if (!sourceNullableElement(type)) return false;
  emitter.emit(Op.NULLABLE, emitter.c.constant(type), 0);
  return true;
}

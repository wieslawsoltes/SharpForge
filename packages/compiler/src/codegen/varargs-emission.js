import {
  Op
} from '@sharpforge/bytecode';

export function emitVarargsExpression(emitter, node) {
  if (node.kind !== 'VarargsOperation') return false;
  if (node.operand) emitter.expr(node.operand);
  emitter.emit(Op[node.operation], node.referent ? emitter.c.constant(node.referent) : 0);
  return true;
}

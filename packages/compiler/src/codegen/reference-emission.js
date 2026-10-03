import {Op} from '@sharpforge/bytecode';

/** Contribution to the existing emitter; each address operand is evaluated exactly once. */
export function emitReferenceExpression(emitter, node) {
  if(node.intrinsic?.reference)node={...node,kind:'ManagedAddress',target:node.args[0],readonly:node.intrinsic.reference.readonly};
  if (node.kind === 'ManagedIndirect') {
    emitter.expr(node.pointer);
    emitter.emit(Op.LDIND, emitter.c.constant(node.legacyType));
    return true;
  }
  if (node.kind !== 'ManagedAddress') return false;
  const ref = emitter.prepare(node.target), immutable = node.readonly ? 4 : 0;
  if (ref.kind === 'indirect') emitter.emit(Op.ADDRESS, 8 | immutable, ref.pointer);
  else if (ref.kind === 'local') emitter.emit(Op.ADDRESS, immutable, ref.slot);
  else if (ref.kind === 'static') emitter.emit(Op.ADDRESS, 1 | immutable, ref.index);
  else if (ref.kind === 'field') { emitter.emit(Op.LDLOC, ref.receiver); emitter.emit(Op.ADDRESS, 2 | immutable, ref.index); }
  else if (ref.kind === 'index') {
    emitter.emit(Op.LDLOC, ref.receiver); emitter.emit(Op.LDLOC, ref.index); emitter.emit(Op.ADDRESS, 3 | immutable);
  } else if (ref.kind === 'rect' || ref.kind === 'span') {
    emitter.emit(Op.LDLOC, ref.receiver);
    for (const index of ref.indices) emitter.emit(Op.LDLOC, index);
    emitter.emit(ref.kind === 'rect' ? Op.RECTADDR : Op.SPANADDR, ref.rank ?? 0);
    if(node.readonly){const pointer=emitter.temp(ref.type+'&');emitter.emit(Op.STLOC,pointer);emitter.emit(Op.POP);emitter.emit(Op.ADDRESS,12,pointer);}
  } else throw new Error('A managed address requires a variable, field, array element or ref return');
  return true;
}

export function prepareReference(emitter, node) {
  if (node.kind !== 'ManagedIndirect') return null;
  emitter.expr(node.pointer);
  const pointer = emitter.temp(node.pointer.legacyType);
  emitter.emit(Op.STLOC, pointer); emitter.emit(Op.POP);
  return {kind: 'indirect', type: node.legacyType, pointer};
}

export function loadReference(emitter, ref) {
  if (ref.kind !== 'indirect') return false;
  emitter.emit(Op.LDLOC, ref.pointer);
  emitter.emit(Op.LDIND, emitter.c.constant(ref.type));
  return true;
}

export function storeReference(emitter, ref) {
  if (ref.kind !== 'indirect') return false;
  const value = emitter.temp(ref.type);
  emitter.emit(Op.STLOC, value); emitter.emit(Op.POP);
  emitter.emit(Op.LDLOC, ref.pointer); emitter.emit(Op.LDLOC, value);
  emitter.emit(Op.STIND, emitter.c.constant(ref.type));
  return true;
}

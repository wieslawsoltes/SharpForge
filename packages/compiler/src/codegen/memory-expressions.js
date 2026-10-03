import {Op} from '@sharpforge/bytecode';

export function emitMemoryExpression(emitter, node) {
  if (node.kind === 'IndexerAccess' && node.indexer.memory) {
    emitter.expr(node.receiver);
    for (const argument of node.args) emitter.expr(argument);
    const memory = node.indexer.memory;
    emitter.emit(memory.kind === 'rect' ? Op.LDRECT : Op.SPANGET, memory.kind === 'rect' ? memory.rank : 0);
    return true;
  }
  const memory = node.intrinsic?.memory;
  if (!memory) return false;
  if (memory.kind === 'allocate') {
    for (const length of node.args.slice(0, memory.rank)) emitter.expr(length);
    emitter.emit(memory.stack ? Op.STACKALLOC : Op.NEWRECT, emitter.c.constant(memory.element), memory.stack ? 0 : memory.rank);
    for (let i = 0; i < memory.indices.length; i++) {
      emitter.emit(Op.DUP);
      for (const index of memory.indices[i]) emitter.emitConstant(index);
      emitter.expr(node.args[memory.rank + i]);
      emitter.emit(memory.stack ? Op.SPANSET : Op.STRECT, memory.stack ? 0 : memory.rank);
      emitter.emit(Op.POP);
    }
  } else {
    if (node.receiver) emitter.expr(node.receiver);
    for (const argument of node.args) emitter.expr(argument);
    emitter.emit(memory.op, memory.element ? emitter.c.constant(memory.element) : 0, memory.b ?? 0);
  }
  return true;
}

export function prepareMemoryTarget(emitter, node) {
  const memory = node.indexer?.memory;
  if (!memory) return null;
  emitter.expr(node.receiver);
  const receiver = emitter.temp(node.receiver.legacyType);
  emitter.emit(Op.STLOC, receiver); emitter.emit(Op.POP);
  const indices = node.args.map(argument => {
    emitter.expr(argument);
    const slot = emitter.temp('int');
    emitter.emit(Op.STLOC, slot); emitter.emit(Op.POP);
    return slot;
  });
  return {kind: memory.kind, type: node.legacyType, receiver, indices, rank: memory.rank};
}

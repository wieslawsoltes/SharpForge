import {
  Op
} from '@sharpforge/bytecode';

function loadReceiver(emitter, type, slot) {
  if (type.valueType) emitter.emit(Op.ADDRESS, 1, slot);
  else emitter.emit(Op.LDLOC, slot);
}

function contractInitializers(emitter, node) {
  if (node.initializers.length) {
    const slot = emitter.temp(node.legacyType);
    emitter.emit(Op.STLOC, slot);
    emitter.emit(Op.POP);
    for (const initializer of node.initializers) {
      emitter.emit(Op.LDLOC, slot);
      emitter.expr(initializer.value);
      emitter.emitContract(initializer.member.contract);
      emitter.emit(Op.POP);
    }
    emitter.emit(Op.LDLOC, slot);
    emitter.clear(slot);
  }
  if (node.collectionInitializers.length) {
    const slot = emitter.temp(node.legacyType);
    emitter.emit(Op.STLOC, slot);
    emitter.emit(Op.POP);
    for (const initializer of node.collectionInitializers) {
      emitter.emit(Op.LDLOC, slot);
      emitter.args(initializer.args);
      emitter.emitContract(initializer.addMethod.contract);
      emitter.emit(Op.POP);
    }
    emitter.emit(Op.LDLOC, slot);
    emitter.clear(slot);
  }
}

/** Object allocation and value initialization share constructor order and explicit receiver storage. */
export function emitObjectCreation(emitter, node) {
  const constructor = node.constructorMethod;
  if (constructor?.builtin) {
    emitter.args(node.args);
    emitter.emit(Op.BUILTIN, constructor.builtin.id, node.args.length);
    return;
  }
  if (constructor?.contract) {
    emitter.args(node.args);
    emitter.emitContract(constructor.contract);
    contractInitializers(emitter, node);
    return;
  }
  const type = node.type.legacy;
  emitter.emit(Op.NEWOBJ, type.id);
  const slot = emitter.temp(node.legacyType);
  emitter.emit(Op.STLOC, slot);
  emitter.emit(Op.POP);
  if (type.initializer !== undefined) {
    loadReceiver(emitter, type, slot);
    emitter.emit(Op.CALL, type.initializer, 1);
    emitter.emit(Op.POP);
  }
  if (constructor) {
    loadReceiver(emitter, type, slot);
    emitter.args(node.args);
    emitter.emit(Op.CALL, constructor.legacy.id, node.args.length + 1);
    emitter.emit(Op.POP);
  }
  for (const initializer of node.initializers) {
    const member = initializer.member.legacy;
    loadReceiver(emitter, type, slot);
    emitter.expr(initializer.value);
    emitter.emit(initializer.member.kind === 'Property' ? Op.CALL : Op.STFLD,
      initializer.member.kind === 'Property' ? member.set.id : member.index, initializer.member.kind === 'Property' ? 2 : 0);
    emitter.emit(Op.POP);
  }
  emitter.emit(Op.LDLOC, slot);
  emitter.clear(slot);
}

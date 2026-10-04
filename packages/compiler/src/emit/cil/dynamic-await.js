/** Dynamic awaiter protocol over the existing async state-machine and builder seams (SF-A02-T55). */

function getAwaiter(emitter, node) {
  const pattern = node.awaitable;
  if (!pattern?.getAwaiter) return emitter.dynamicSite(node, 'awaiter');
  if (pattern.isExtension || pattern.getAwaiter.isStatic) emitter.expression(node.operand);
  else emitter.receiver(node.operand);
  return emitter.callMethod(pattern.getAwaiter, { receiver: node.operand, syntax: node.syntax });
}

/** Register completion through the interface implemented by the boxed awaiter; custom awaiters keep their identity. */
function schedule(emitter, slot) {
  const il = emitter.il;
  const critical = emitter.core.icriticalNotifyCompletion;
  const notify = emitter.core.inotifyCompletion;
  const criticalSlot = emitter.transient(critical);
  const notifySlot = emitter.transient(notify);
  const ordinary = il.newLabel();
  il.emit('ldloc', slot).emit('isinst', emitter.tokens.type(critical)).emit('stloc', criticalSlot);
  il.emit('ldloc', criticalSlot).emit('brfalse', ordinary);
  emitter.pushBuilder();
  il.emit('ldloca', criticalSlot).emit('ldloca', emitter.selfSlot);
  emitter.builderMembers.awaitOnCompleted(il, critical, true);
  il.emit('leave', emitter.suspended).mark(ordinary);
  il.emit('ldloc', slot).emit('castclass', emitter.tokens.type(notify)).emit('stloc', notifySlot);
  emitter.pushBuilder();
  il.emit('ldloca', notifySlot).emit('ldloca', emitter.selfSlot);
  emitter.builderMembers.awaitOnCompleted(il, notify, false);
  il.emit('leave', emitter.suspended);
}

/** Evaluate and await a runtime-bound awaiter; restore pending operands around suspension exactly as static await does. */
export function emitDynamicAwait(emitter, node, isUsed) {
  if (!emitter.isAsyncBody) return emitter.unsupported('await outside an async method', node.syntax);
  const il = emitter.il;
  const saved = emitter.savePending(node.syntax);
  const slot = emitter.transient(emitter.core.object);
  const completedValue = emitter.transient(emitter.core.object);
  const completed = il.newLabel();
  const resume = il.newLabel();
  const field = emitter.awaiterField(emitter.core.object);
  const pushAwaiter = () => il.emit('ldloc', slot);
  emitter.selfSlot ??= emitter.transient(emitter.machine.type);
  getAwaiter(emitter, node);
  il.emit('stloc', slot);
  emitter.dynamicSite(node, 'completed', [pushAwaiter]);
  il.emit('stloc', completedValue);
  emitter.dynamicSite(node, 'completedBool', [() => il.emit('ldloc', completedValue)]);
  il.emit('brtrue', completed);
  emitter.storeState(emitter.newState(resume));
  il.emit('ldarg', 0).emit('ldloc', slot).emit('stfld', field.token);
  il.emit('ldarg', 0).emit('stloc', emitter.selfSlot);
  schedule(emitter, slot);
  emitter.resumeAt(resume);
  il.emit('ldarg', 0).emit('ldfld', field.token).emit('stloc', slot);
  il.emit('ldarg', 0).emit('ldnull').emit('stfld', field.token).mark(completed);
  emitter.dynamicSite(node, isUsed ? 'result' : 'resultEffect', [pushAwaiter]);
  const resultType = isUsed ? node.type : emitter.core.void;
  emitter.restorePending(saved, resultType);
  return isUsed ? undefined : false;
}

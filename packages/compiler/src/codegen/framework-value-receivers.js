import {frameworkType} from '@sharpforge/framework';
import {Op} from '@sharpforge/bytecode';

const locations = new Set(['Local', 'Parameter', 'ThisReference', 'FieldAccess', 'ArrayAccess']);
const isValue = node => frameworkType(node?.legacyType)?.kind === 'value';

/** Cache a value receiver and its writable location before evaluating the assignment's right-hand side. */
export function prepareFrameworkReceiver(emitter, node) {
  if (!node) return {receiver: null};
  const valueOwner = isValue(node) && locations.has(node.kind) ? emitter.prepare(node) : null;
  if (valueOwner) emitter.loadRef(valueOwner);
  else emitter.expr(node);
  const receiver = emitter.temp(node.legacyType);
  emitter.emit(Op.STLOC, receiver);
  emitter.emit(Op.POP);
  return {receiver, valueOwner};
}

/** A property setter mutates its owned receiver; publish that value back into the original location once. */
export function storeFrameworkReceiver(emitter, reference) {
  if (!reference.valueOwner) return;
  emitter.emit(Op.LDLOC, reference.receiver);
  emitter.storeRef(reference.valueOwner);
  emitter.emit(Op.POP);
}

/** Freeze each by-value argument before later arguments can mutate the originating variable. */
export function emitFrameworkValueArgument(emitter, argument) {
  emitter.expr(argument);
  if (!isValue(argument)) return;
  const slot = emitter.temp(argument.legacyType);
  emitter.emit(Op.STLOC, slot);
  emitter.emit(Op.POP);
  emitter.emit(Op.LDLOC, slot);
  emitter.clear(slot);
}

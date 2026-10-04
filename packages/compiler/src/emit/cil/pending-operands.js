/**
 * Saving the evaluation stack (SF-A02-T30): an `await` suspends the method with an empty stack and a `stackalloc`
 * needs one, so the operands that are already evaluated are moved to temporaries and pushed back afterwards.
 *
 * A value is saved in a temporary of its type. The address of a local variable (`ldloca`, the receiver of a struct
 * method call) is not a value that can be kept - a managed pointer cannot be a field of a state machine - so it is
 * dropped and taken again: the local itself survives, hoisted when a suspension lies in between.
 */
import { LocalAddress } from './il-stack-types.js';

/**
 * Empties the evaluation stack.
 * @param emitter a method emitter (`il`, `temp`)
 * @returns {object[]|null} what `restorePendingOperands` takes, bottom first; null when the stack holds a value of
 *   unknown type (nothing is emitted then)
 */
export function savePendingOperands(emitter) {
  const entries = emitter.il.pendingTypes;
  if (entries.includes(null)) return null;
  const saved = entries.map(entry => (entry instanceof LocalAddress ? entry : { slot: emitter.temp(entry) }));
  for (let index = saved.length - 1; index >= 0; index--) {
    if (saved[index] instanceof LocalAddress) emitter.il.emit('pop');
    else emitter.il.emit('stloc', saved[index].slot);
  }
  return saved;
}

/**
 * Pushes the saved operands back, below the value on top of the stack when `resultType` names one.
 * @param {object[]} saved the result of `savePendingOperands`  @param resultType the type of the value on top, or null
 */
export function restorePendingOperands(emitter, saved, resultType) {
  if (!saved.length) return;
  const il = emitter.il,
    result = resultType ? emitter.temp(resultType) : null;
  if (result !== null) il.emit('stloc', result);
  for (const entry of saved) il.emit(entry instanceof LocalAddress ? 'ldloca' : 'ldloc', entry.slot);
  if (result !== null) il.emit('ldloc', result);
}

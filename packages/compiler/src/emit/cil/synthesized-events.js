/**
 * The accessors of a field-like event (SF-A02-T30): `add_E` combines the handler into the event's delegate field and
 * `remove_E` removes it.
 *
 *   field = (EventType)Delegate.Combine(field, value);
 *
 * Roslyn emits a compare-exchange loop so that concurrent subscriptions are not lost; the execution profile runs
 * managed code on one thread at a time, and on .NET the plain form differs only under a race.
 */
import { IlBuilder } from './il-builder.js';

function accessorBody(program, event, field, isAdd) {
  const core = program.core,
    delegate = core.delegate,
    il = new IlBuilder(),
    isStatic = !!event.isStatic,
    shape = { isStatic: true, returnType: delegate, parameters: [{ type: delegate }, { type: delegate }] };
  if (!isStatic) il.emit('ldarg', 0).emit('ldarg', 0);
  il.emit(isStatic ? 'ldsfld' : 'ldfld', field.token);
  il.emit('ldarg', isStatic ? 0 : 1);
  il.emit('call', program.tokens.external(delegate, isAdd ? 'Combine' : 'Remove', shape), { pops: 2, pushes: 1 });
  il.emit('castclass', program.tokens.type(event.type));
  il.emit(isStatic ? 'stsfld' : 'stfld', field.token);
  return il.emit('ret', undefined, { pops: 0, pushes: 0 });
}

/**
 * Gives the synthesized accessors of a field-like event their bodies.
 * @param type the containing type  @param {{symbol, adder, remover}} planned the planned event  @param plan the member plan
 */
export function completeFieldLikeEvent(type, planned, plan) {
  const event = planned.symbol,
    field = plan.fields.find(entry => !entry.symbol && entry.name === event.name);
  if (!field) return;
  for (const [accessor, isAdd] of [
    [planned.adder, true],
    [planned.remover, false],
  ]) {
    if (accessor.symbol || !accessor.hasBody || accessor.emitBody) continue;
    accessor.emitBody = program => accessorBody(program, event, field, isAdd);
  }
}

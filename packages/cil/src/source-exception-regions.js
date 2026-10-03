import {Op} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

/** Source handlers keep explicit ends; older images derive catch ends from sibling entries. */
export function sourceHandlerLayout(method) {
  return method.handlers.map(handler => {
    if (handler.handlerEnd !== undefined) return {...handler, handlerEndPc: handler.handlerEnd};
    const after = method.code[handler.end * 3] === Op.JUMP ? method.code[handler.end * 3 + 1] : null;
    if (after === null) throw new CilError('Unsupported exception region layout');
    const siblings = method.handlers.filter(other => other.start === handler.start && other.end === handler.end &&
      other.target > handler.target).sort((left, right) => left.target - right.target);
    return {...handler, handlerEndPc: siblings[0]?.filter ?? siblings[0]?.target ?? after};
  });
}

/** CLI handlers and filters receive an exception on the stack; source IR uses a local. */
export function emitSourceHandlerEntry(writer, context, handlers, pc, prefixes) {
  const filter = handlers.find(handler => handler.filter === pc);
  if (filter) {
    prefixes.set(pc, writer.length);
    const body = 'source-filter-' + pc;
    writer.op('isinst', context.resolveType(filter.type ?? 'Exception')).local('stloc', filter.slot)
      .local('ldloc', filter.slot).op('brtrue', body).integer(0).op('endfilter').mark(body);
  }
  const handler = handlers.find(candidate => candidate.target === pc);
  if (handler) {
    prefixes.set(pc, writer.length);
    if (handler.filter !== undefined) writer.op('castclass', context.resolveType(handler.type ?? 'Exception'));
    if (handler.kind !== 'finally') writer.local('stloc', handler.slot);
  }
}

export function sourceHandlerZones(handlers, pc) {
  const zones = [];
  handlers.forEach((handler, index) => {
    if (pc >= handler.start && pc <= handler.end) zones.push('try' + index);
    if (pc >= handler.target && pc < handler.handlerEndPc) zones.push('handler' + index);
    if (handler.filter !== undefined && pc >= handler.filter && pc < handler.target) zones.push('filter' + index);
  });
  return zones;
}

export function nativeSourceHandlers(context, handlers, layout) {
  const {starts, spans, prefixes, returnOffset} = layout;
  return handlers.map(handler => {
    const flags = handler.kind === 'finally' ? 2 : handler.filter !== undefined ? 1 : 0;
    return {
      start: starts[handler.start], end: spans[handler.end][0] + spans[handler.end][1],
      target: prefixes.get(handler.target),
      handlerEnd: prefixes.get(handler.handlerEndPc) ?? starts[handler.handlerEndPc] ?? returnOffset,
      catchType: flags === 2 ? 0 : flags === 1 ? prefixes.get(handler.filter) : context.resolveType(handler.type ?? 'Exception'),
      ...(flags ? {flags} : {})
    };
  });
}

/** CLI clause entries receive a stack exception; source handlers read the declared local. */
export function emitSourceHandlerEntry(writer, context, layout, pc, prefixes) {
  const decision = layout.filterDecisionAt(pc);
  if (decision) writer.mark('source-filter-end-' + decision.target);
  const filter = layout.filterAt(pc);
  if (filter) {
    prefixes.set(pc, writer.length);
    const body = 'source-filter-' + pc;
    writer.op('isinst', context.resolveType(filter.type ?? 'Exception')).local('stloc', filter.slot)
      .local('ldloc', filter.slot).op('brtrue', body).integer(0)
      .op('br', 'source-filter-end-' + filter.target).mark(body);
  }
  const handler = layout.handlerAt(pc);
  if (handler) {
    prefixes.set(pc, writer.length);
    if (handler.filter !== undefined) writer.op('castclass', context.resolveType(handler.type ?? 'Exception'));
    if (handler.kind !== 'finally') writer.local('stloc', handler.slot);
  }
}

/** Executable filter offsets and typed tokens are resolved after every source span is known. */
export function nativeSourceHandlers(context, handlers, {
  starts,
  prefixes,
  returnOffset
}) {
  const boundary = pc => prefixes.get(pc) ?? starts[pc] ?? returnOffset;
  return handlers.map(handler => {
    const flags = handler.kind === 'finally' ? 2 : handler.filter !== undefined ? 1 : 0;
    return {
      start: starts[handler.start],
      end: boundary(handler.tryEndPc),
      target: prefixes.get(handler.target),
      handlerEnd: boundary(handler.handlerEndPc),
      catchType: flags === 2 ? 0 : flags === 1 ? prefixes.get(handler.filter) : context.resolveType(handler.type ?? 'Exception'),
      ...(flags ? {
        flags
      } : {})
    };
  });
}

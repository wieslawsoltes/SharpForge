import {
  CilError
} from './binary.js';

function localStore(instruction) {
  if (!instruction?.name.startsWith('stloc')) return null;
  return instruction.operand ?? Number(instruction.name.slice(-1));
}

/** Decode only the canonical entry scaffolding; full re-emission still checks every byte. */
export function loadSourceHandlers(context) {
  const {
    metadata,
    method,
    body,
    spans,
    byOffset,
    startToPc
  } = context;
  const boundary = offset => startToPc.get(offset) ?? (() => {
    const previous = spans.findIndex(span => span[0] + span[1] === offset);
    return previous < 0 ? undefined : previous + 1;
  })();
  return body.handlers.map(handler => {
    const flags = handler.flags ?? 0;
    const start = startToPc.get(handler.start);
    const end = spans.findIndex(span => span[0] + span[1] === handler.end);
    const handlerEnd = boundary(handler.handlerEnd);
    if (start === undefined || end < 0 || handlerEnd === undefined) throw new CilError('Unsupported exception boundaries');
    if (flags === 2) {
      const target = startToPc.get(handler.target);
      if (target === undefined || handlerEnd <= target) throw new CilError('Unsupported finally-region encoding');
      return {
        kind: 'finally',
        start,
        end,
        target,
        handlerEnd
      };
    }
    const entry = byOffset.get(handler.target);
    const prefix = entry?.name === 'castclass' ? byOffset.get(entry.offset + entry.size) : entry;
    const slot = localStore(prefix);
    const target = prefix ? startToPc.get(prefix.offset + prefix.size) : undefined;
    if (slot === null || slot < 0 || slot >= method.locals.length || target === undefined || handlerEnd <= target) {
      throw new CilError('Unsupported catch-region encoding');
    }
    if (flags === 0) {
      const name = metadata.typeName(handler.catchType);
      return {
        start,
        end,
        target,
        handlerEnd,
        slot,
        type: name === 'System.Exception' ? 'Exception' : name
      };
    }
    if (flags !== 1) throw new CilError('Unsupported source exception clause');
    const cast = byOffset.get(handler.catchType);
    const store = cast && byOffset.get(cast.offset + cast.size);
    const load = store && byOffset.get(store.offset + store.size);
    const branch = load && byOffset.get(load.offset + load.size);
    const filter = branch && startToPc.get(branch.operand);
    if (cast?.name !== 'isinst' || localStore(store) !== slot || !load?.name.startsWith('ldloc') ||
      branch?.name !== 'brtrue' || filter === undefined || filter >= target) {
      throw new CilError('Unsupported filter-region encoding');
    }
    const name = metadata.typeName(cast.operand);
    return {
      start,
      end,
      target,
      handlerEnd,
      slot,
      type: name === 'System.Exception' ? 'Exception' : name,
      filter
    };
  });
}

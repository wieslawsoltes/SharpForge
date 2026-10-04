import {CilError} from './binary.js';
import {canonicalCatchType} from './canonical-exceptions.js';

/** Recover approved catch types and finally regions from actual CLI exception tables and instruction boundaries. */
export function decodeCanonicalHandlers({body, spans, byOffset, startToPc, locals, metadata, localIndex}) {
  const ends = new Map(spans.map(([start, length], index) => [start + length, index]));
  const handlers = [];
  for (const handler of body.handlers) {
    const start = startToPc.get(handler.start);
    const end = ends.get(handler.end);
    if (handler.flags === 2) {
      const target = startToPc.get(handler.target);
      const handlerEnd = startToPc.get(handler.handlerEnd) ?? (ends.get(handler.handlerEnd) ?? -1) + 1;
      if (start === undefined || end === undefined || target === undefined || handlerEnd <= target) {
        throw new CilError('Unsupported finally-region encoding');
      }
      handlers.push({kind: 'finally', start, end, target, handlerEnd});
      continue;
    }
    const prefix = byOffset.get(handler.target);
    const slot = prefix ? localIndex(prefix, 'stloc') : null;
    const target = prefix ? startToPc.get(handler.target + prefix.size) : undefined;
    if (slot === null || slot < 0 || slot >= locals.length || target === undefined || start === undefined
      || end === undefined || (handler.flags ?? 0) !== 0) throw new CilError('Unsupported catch-region encoding');
    handlers.push({start, end, target, slot, type: canonicalCatchType(metadata.typeName(handler.catchType))});
  }
  return handlers;
}

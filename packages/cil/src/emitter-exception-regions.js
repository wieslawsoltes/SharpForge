import {Op} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {canonicalCatchType} from './canonical-exceptions.js';

/** Index sibling handlers once; only equal protected regions share the next handler boundary. */
export function canonicalHandlerLayout(method) {
  const regions = new Map();
  const nextHandler = new Map();
  for (const handler of method.handlers) {
    const key = handler.start + ':' + handler.end;
    const siblings = regions.get(key) ?? [];
    siblings.push(handler);
    regions.set(key, siblings);
  }
  for (const siblings of regions.values()) {
    siblings.sort((left, right) => left.target - right.target);
    for (let index = 0; index + 1 < siblings.length; index++) nextHandler.set(siblings[index], siblings[index + 1].target);
  }
  return method.handlers.map(handler => {
    if (handler.kind === 'finally') return {...handler, handlerEndPc: handler.handlerEnd};
    const after = method.code[handler.end * 3] === Op.JUMP ? method.code[handler.end * 3 + 1] : null;
    if (after === null) throw new CilError('Unsupported exception region layout');
    return {...handler, handlerEndPc: nextHandler.get(handler) ?? after};
  });
}

/** Encode typed handlers with exact approved catch identity; arbitrary user exception classes remain unsupported. */
export function emitCanonicalHandlers({handlers, starts, spans, prefixes, returnOffset, resolveType}) {
  return handlers.map(handler => ({
    start: starts[handler.start],
    end: spans[handler.end][0] + spans[handler.end][1],
    target: prefixes.get(handler.target),
    handlerEnd: prefixes.get(handler.handlerEndPc) ?? starts[handler.handlerEndPc] ?? returnOffset,
    catchType: handler.kind === 'finally' ? 0 : resolveType(canonicalCatchType(handler.type ?? 'Exception')),
    ...(handler.kind === 'finally' ? {flags: 2} : {})
  }));
}

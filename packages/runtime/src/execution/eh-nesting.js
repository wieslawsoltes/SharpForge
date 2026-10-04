import {cancelArrayOperation} from './array-ops.js';

export function insideRegion(offset, handler) {
  return offset >= handler.start && offset < handler.end;
}

/** Innermost protected region first; metadata order breaks equal-region ties. */
export function activeClauses(frame, offset) {
  return frame.method.handlers.filter(handler => insideRegion(offset, handler))
    .sort((left, right) => (left.end - left.start) - (right.end - right.start));
}

/** Fault runs only during exceptional exit; leave runs finally clauses only. */
export function cleanupClauses(frame, source, target = Infinity, exceptional = false) {
  if (frame.needsInitialization || frame.filterSearch) return [];
  return activeClauses(frame, source).filter(handler =>
    (handler.flags === 2 || exceptional && handler.flags === 4) && !insideRegion(target, handler));
}

export function stageExceptionalUnwind(frame, search, offset) {
  const selection = search.selection;
  const catcher = selection?.kind === 'catch' && selection.frameId === frame.id ? selection.handler : null;
  // A catch inside an executing finally preserves that finally's prior continuation.
  frame.unwinds = frame.unwinds.filter(unwind => unwind.active && catcher &&
    catcher.target >= unwind.active.target && catcher.target < unwind.active.handlerEnd);
  cancelArrayOperation(frame);
  frame.pending = {kind: 'exception', error: search.error, catch: catcher,
    handlers: cleanupClauses(frame, offset, catcher?.target, true), search};
  frame.unwinds.push(frame.pending);
  frame.stack.length = 0;
  frame.volatileAccess = false;
  return frame.pending;
}

export function stageLeave(frame, instruction) {
  frame.stack.length = 0;
  frame.pending = {kind: 'leave', target: instruction.operand,
    handlers: cleanupClauses(frame, instruction.offset, instruction.operand)};
  frame.unwinds.push(frame.pending);
  return frame.pending;
}

export function enterSelectedCatch(frame, pending) {
  const handler = pending.catch;
  frame.caught = frame.caught.filter(caught => handler.target >= caught.start &&
    handler.target < caught.end && caught.start !== handler.target);
  frame.caught.push({start: handler.target, end: handler.handlerEnd, fault: pending.error});
  frame.exception = pending.error;
  frame.stack.length = 0;
  frame.stack.push(pending.error.reference);
  frame.pc = frame.offsets.get(handler.target);
  pending.error.phase = 'handled';
}

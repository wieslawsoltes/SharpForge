import {notifyFirstChance,continueExceptionEvent,firstChanceCallbackFailure} from './exception-events.js';
import {prepareException, faultFromException} from './exception-object.js';
import {ManagedFault} from '../heap.js';
import {failInitialization} from './static-init.js';
import {retireExceptionFrame as popFrame} from './control-frames.js';
import {frameById} from './frame-lifetimes.js';
import {enterFilter, finishFilter} from './eh-filters.js';
import {activeClauses, stageExceptionalUnwind, stageLeave, enterSelectedCatch} from './eh-nesting.js';
import {isFatalFault, markUnhandled} from './unhandled.js';
export {fatalFaults} from './unhandled.js';
export {createExceptionState} from './exception-state.js';

export function* exceptionRoots(frame) {
  if (frame.exception?.reference) yield frame.exception.reference;
  for (const caught of frame.caught ?? []) if (caught.fault.reference) yield caught.fault.reference;
  for (const unwind of frame.unwinds ?? []) {
    if (unwind.error?.reference) yield unwind.error.reference;
    if (unwind.value !== undefined) yield unwind.value;
  }
  if (frame.filterSearch?.error.reference) yield frame.filterSearch.error.reference;
}

function createSearch(vm, error) {
  const frames = [...vm.frames].reverse().map(frame => ({id: frame.id, offset: frame.lastOffset}));
  return {error, frames, locations: new Map(frames.map(frame => [frame.id, frame.offset])),
    cursor: 0, clause: 0, clauses: null, selection: null};
}

/** First pass performs no cleanup. The frame index makes cross-frame lookup O(1). */
function searchStep(vm, search) {
  while (search.cursor < search.frames.length) {
    const location = search.frames[search.cursor];
    const frame = frameById(vm, location.id);
    if (!frame) { search.cursor++; search.clause = 0; search.clauses = null; continue; }
    search.clauses ??= frame.needsInitialization || frame.filterSearch ? [] : activeClauses(frame, location.offset);
    while (search.clause < search.clauses.length) {
      const handler = search.clauses[search.clause++];
      if (handler.flags === 0 && vm.matches(search.error.reference, vm.inspector.metadata.typeName(handler.catchType))) {
        search.selection = {kind: 'catch', frameId: frame.id, handler};
        return {phase: 'unwind', search};
      }
      if (handler.flags === 1) {
        enterFilter(vm, frame, handler, search);
        return null;
      }
    }
    if (frame.exceptionEventContinuation) {
      const fatal = firstChanceCallbackFailure(frame, search.error);
      if (fatal) { markUnhandled(vm, fatal); return null; }
      search.selection = {kind: 'event-failure', frameId: frame.id};
      return {phase: 'unwind', search};
    }
    if (frame.initializes || frame.filterSearch) {
      search.selection = {kind: frame.initializes ? 'initializer' : 'filter-failure', frameId: frame.id};
      return {phase: 'unwind', search};
    }
    search.cursor++;
    search.clause = 0;
    search.clauses = null;
  }
  markUnhandled(vm, search.error);
  return null;
}

function finishPending(vm, frame) {
  const pending = frame.pending;
  if (!pending) throw new ManagedFault('InvalidProgramException', 'endfinally outside an unwind');
  if (pending.handlers.length) {
    pending.active = pending.handlers.shift();
    frame.pc = frame.offsets.get(pending.active.target);
    frame.stack.length = 0;
    return null;
  }
  frame.unwinds.pop();
  frame.pending = frame.unwinds.at(-1) ?? null;
  if (pending.kind === 'leave') { frame.pc = frame.offsets.get(pending.target); return null; }
  if (pending.catch) { enterSelectedCatch(frame, pending); return null; }
  const search = pending.search;
  if (search?.selection?.kind === 'filter-failure' && search.selection.frameId === frame.id) {
    return {phase: 'search', search: finishFilter(vm, 0)};
  }
  if (search?.selection?.kind === 'event-failure' && search.selection.frameId === frame.id) {
    popFrame(vm);
    const event = continueExceptionEvent(vm, frame);
    if (event.continued) return null;
    if (event.phase === 'unhandled') { markUnhandled(vm, event.fault); return null; }
    return {phase: 'raise', error: event.fault};
  }
  const error = frame.initializes ? failInitialization(vm, frame, pending.error) : pending.error;
  popFrame(vm);
  return frame.initializes || !search ? {phase: 'raise', error} : {phase: 'unwind', search};
}

function unwindStep(vm, search) {
  const frame = vm.top;
  if (!frame) { markUnhandled(vm, search.error); return null; }
  stageExceptionalUnwind(frame, search, search.locations.get(frame.id) ?? frame.lastOffset);
  vm.fault = null;
  return finishPending(vm, frame);
}

function raiseStep(vm, fault) {
  vm.fault = fault;
  if (isFatalFault(fault)) { markUnhandled(vm, fault); return null; }
  if (notifyFirstChance(vm, fault)) return null;
  prepareException(vm, fault);
  fault.phase = 'search';
  if (!vm.top) { markUnhandled(vm, fault); return null; }
  vm.top.volatileAccess = false;
  vm.fault = null;
  return {phase: 'search', search: createSearch(vm, fault)};
}

/** Explicit trampoline: unwinding 10,000 frames consumes no JavaScript recursion. */
function drive(vm, initial) {
  let action = initial;
  try {
    while (action) {
      if (action.phase === 'raise') action = raiseStep(vm, action.error);
      else if (action.phase === 'search') action = searchStep(vm, action.search);
      else action = unwindStep(vm, action.search);
    }
  } catch (error) {
    const fault = error instanceof ManagedFault ? error : new ManagedFault('InvalidProgramException', error.message);
    markUnhandled(vm, fault);
  }
}

export function endFilter(vm, value) {
  const search = finishFilter(vm, value);
  drive(vm, {phase: search.selection ? 'unwind' : 'search', search});
}

/** Enter a leave or resume a paused finally continuation. */
export function continueUnwind(vm, frame, leave = null) {
  if (leave) stageLeave(frame, leave);
  drive(vm, finishPending(vm, frame));
}

/** Explicit throw resets its trace; rethrow retains the active catch's fault identity. */
export function throwFault(vm, error, instruction = null) {
  if (instruction?.name === 'rethrow') {
    const caught = [...vm.top.caught].reverse().find(item => instruction.offset >= item.start && instruction.offset < item.end);
    if (!caught) throw new ManagedFault('InvalidProgramException', 'No active catch');
    throw caught.fault;
  }
  if (instruction?.name === 'throw') throw faultFromException(vm, vm.pop());
  const fault = error instanceof ManagedFault ? error : new ManagedFault('InvalidProgramException', error.message ?? String(error));
  drive(vm, {phase: 'raise', error: fault});
}

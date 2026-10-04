import {deliverSourceReturn} from './source-return.js';
import {continueControlReturn} from './return-control.js';
import {notifyFirstChance, exceptionEventRoots, continueExceptionEvent, firstChanceCallbackFailure} from './exception-events.js';
import {prepareException} from './exception-object.js';

import {ManagedFault} from '../heap.js';
import {pushControlFrame as pushFrame, retireExceptionFrame as popFrame} from './control-frames.js';
import {frameById, nextFrameId} from './frame-lifetimes.js';
import {exceptionMatches} from './exception-types.js';
import {isFatalFault, markUnhandled} from './unhandled.js';

export function frameState() { return {exception: null, caught: [], unwinds: []}; }

/** Exception continuations can own the only live reference to a return value or fault. */
export function* roots(vm) {
  for (const frame of vm.frames) {
    yield* exceptionEventRoots(frame);
    for (const unwind of frame.unwinds ?? []) {
      yield unwind.value;
      yield unwind.error?.reference;
    }
    yield frame.exception?.reference;
    yield frame.filterSearch?.error.reference;
    for (const caught of frame.caught ?? []) yield caught.fault.reference;
  }
  yield vm.fault?.reference;
  yield vm.pendingFault?.reference;
}

export function makeFault(error) {
  return error instanceof ManagedFault ? error : new ManagedFault('RuntimeException', error?.message ?? String(error));
}

export function enterCatch(vm, frame, handler, fault) {
  const method = vm.image.methods[frame.methodId];
  const siblings = method.handlers.filter(other => other.start === handler.start && other.end === handler.end &&
    other.target > handler.target).sort((left, right) => left.target - right.target);
  const end = handler.handlerEnd ?? siblings[0]?.filter ?? siblings[0]?.target ?? method.code[handler.end * 3 + 1];
  frame.caught = frame.caught.filter(caught => handler.target >= caught.start && handler.target < caught.end &&
    caught.start !== handler.target);
  frame.caught.push({start: handler.target, end, fault});
  frame.exception = fault;
  frame.locals[handler.slot] = fault.reference;
  frame.pc = handler.target;
  fault.phase = 'handled';
  vm.fault = null;
}

/** Jumps at the inclusive end boundary leave a source protected region too. */
export function finalizers(vm, frame, source, target = Infinity) {
  if (frame.filterSearch) return [];
  return vm.image.methods[frame.methodId].handlers
    .filter(handler => handler.kind === 'finally' && source >= handler.start && source <= handler.end &&
      !(target >= handler.start && target <= handler.end))
    .sort((left, right) => (left.end - left.start) - (right.end - right.start));
}

export function finishReturn(vm, frame, value) {
  vm.stack.length = frame.base;
  popFrame(vm, 'return');
  const control = continueControlReturn(vm, frame, value);
  if (control.handled) return;
  deliverSourceReturn(vm, control.value);
}

export function transfer(vm, frame, kind, target, value) {
  const handlers = finalizers(vm, frame, frame.pc - 1, target);
  if (!handlers.length) {
    if (kind === 'return') finishReturn(vm, frame, value);
    else frame.pc = target;
    return;
  }
  frame.unwinds.push({kind, target, value, handlers, active: null});
  vm.stack.length = frame.base;
  resumeUnwind(vm, frame);
}

function matches(vm, fault, type) {
  if (type == null) return true;
  if (exceptionMatches(fault.name, type)) return true;
  const target = vm.heap.methodTables.get(type ?? 'Exception');
  for (let table = vm.heap.get(fault.reference).methodTable; table; table = table.base) {
    if (table === target) return true;
  }
  return false;
}

function createSearch(vm, error) {
  const frames = [...vm.frames].reverse().map(frame => ({id: frame.id, offset: frame.pc - 1}));
  return {error, frames, locations: new Map(frames.map(frame => [frame.id, frame.offset])),
    cursor: 0, clause: 0, clauses: null, selection: null};
}

function enterFilter(vm, owner, handler, search) {
  if (vm.options.maxFrames !== undefined && vm.frames.length >= vm.options.maxFrames) {
    const fault = new ManagedFault('StackOverflowException', 'Explicit managed filter frame limit exceeded');
    fault.runtimeOrigin = true;
    fault.fatal = true;
    throw fault;
  }
  owner.locals[handler.slot] = search.error.reference;
  pushFrame(vm, {
    id: nextFrameId(vm), methodId: owner.methodId, pc: handler.filter, base: vm.stack.length,
    locals: owner.locals, point: owner.point, ...frameState(),
    ...(owner.varargs ? {varargs: owner.varargs} : {}),
    filterSearch: search, filterOwnerId: owner.id, filterHandler: handler
  });
}

function finishFilter(vm, decision) {
  const frame = vm.top;
  const search = frame?.filterSearch;
  if (!search) throw new ManagedFault('InvalidProgramException', 'endfilter outside a source filter');
  if (typeof decision === 'boolean') decision = decision ? 1 : 0;
  if (!Number.isInteger(decision) || decision < -2147483648 || decision > 2147483647) {
    throw new ManagedFault('InvalidProgramException', 'endfilter requires an Int32 decision');
  }
  vm.stack.length = frame.base;
  popFrame(vm);
  if (decision !== 0) search.selection = {kind: 'catch', frameId: frame.filterOwnerId, handler: frame.filterHandler};
  return search;
}

/** First pass keeps every throwing frame alive until all eligible filters decide. */
function searchStep(vm, search) {
  while (search.cursor < search.frames.length) {
    const location = search.frames[search.cursor];
    const frame = frameById(vm, location.id);
    if (!frame) { search.cursor++; search.clause = 0; search.clauses = null; continue; }
    search.clauses ??= frame.filterSearch ? [] : vm.image.methods[frame.methodId].handlers
      .filter(handler => handler.kind !== 'finally' && location.offset >= handler.start && location.offset < handler.end)
      .sort((left, right) => (left.end - left.start) - (right.end - right.start));
    while (search.clause < search.clauses.length) {
      const handler = search.clauses[search.clause++];
      if (!matches(vm, search.error, handler.type)) continue;
      if (handler.filter !== undefined) {
        enterFilter(vm, frame, handler, search);
        return null;
      }
      search.selection = {kind: 'catch', frameId: frame.id, handler};
      return {phase: 'unwind', search};
    }
    if (frame.exceptionEventContinuation) {
      const fatal = firstChanceCallbackFailure(frame, search.error);
      if (fatal) { markUnhandled(vm, fatal); return null; }
      search.selection = {kind: 'event-failure', frameId: frame.id};
      return {phase: 'unwind', search};
    }
    if (frame.filterSearch) {
      search.selection = {kind: 'filter-failure', frameId: frame.id};
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
  const unwind = frame.unwinds.at(-1);
  if (!unwind) throw new ManagedFault('InvalidProgramException', 'No active finally continuation');
  if (unwind.handlers.length) {
    unwind.active = unwind.handlers.shift();
    frame.pc = unwind.active.target;
    vm.stack.length = frame.base;
    return null;
  }
  frame.unwinds.pop();
  if (unwind.kind === 'return') { finishReturn(vm, frame, unwind.value); return null; }
  if (unwind.kind === 'jump') { frame.pc = unwind.target; return null; }
  if (unwind.catch) { enterCatch(vm, frame, unwind.catch, unwind.error); return null; }
  if (unwind.search.selection?.kind === 'filter-failure' && unwind.search.selection.frameId === frame.id) {
    return {phase: 'search', search: finishFilter(vm, 0)};
  }
  if (unwind.search.selection?.kind === 'event-failure' && unwind.search.selection.frameId === frame.id) {
    popFrame(vm);
    vm.stack.length = frame.base;
    const event = continueExceptionEvent(vm, frame);
    if (event.continued) return null;
    if (event.phase === 'unhandled') { markUnhandled(vm, event.fault); return null; }
    return {phase: 'raise', error: event.fault};
  }
  popFrame(vm);
  vm.stack.length = frame.base;
  return {phase: 'unwind', search: unwind.search};
}

function unwindStep(vm, search) {
  const frame = vm.top;
  if (!frame) { markUnhandled(vm, search.error); return null; }
  const catcher = search.selection?.kind === 'catch' && search.selection.frameId === frame.id ? search.selection.handler : null;
  frame.unwinds = frame.unwinds.filter(unwind => unwind.active && catcher &&
    catcher.target >= unwind.active.target && catcher.target < unwind.active.handlerEnd);
  frame.unwinds.push({kind: 'exception', error: search.error, catch: catcher, search, active: null,
    handlers: finalizers(vm, frame, search.locations.get(frame.id) ?? frame.pc - 1, catcher?.target)});
  vm.stack.length = frame.base;
  vm.fault = null;
  return finishPending(vm, frame);
}

/** An explicit trampoline keeps cross-frame unwinds off the host JavaScript stack. */
function drive(vm, initial) {
  let action = initial;
  try {
    while (action) {
      if (action.phase === 'raise') action = raiseStep(vm, action.error);
      else action = action.phase === 'search' ? searchStep(vm, action.search) : unwindStep(vm, action.search);
    }
  } catch (error) {
    markUnhandled(vm, makeFault(error));
  }
}

export function resumeUnwind(vm, frame) {
  drive(vm, finishPending(vm, frame));
}

export function endSourceFilter(vm, decision) {
  const search = finishFilter(vm, decision);
  drive(vm, {phase: search.selection ? 'unwind' : 'search', search});
}

export function rethrow(frame) {
  throw [...frame.caught].reverse().find(caught => frame.pc - 1 >= caught.start && frame.pc - 1 < caught.end)?.fault
    ?? new ManagedFault('InvalidOperationException', 'No active exception to rethrow');
}

function raiseStep(vm, fault) {
  vm.fault = fault;
  if (isFatalFault(fault)) { markUnhandled(vm, fault); return null; }
  if (notifyFirstChance(vm, fault)) return null;
  prepareException(vm, fault);
  fault.phase = 'search';
  vm.fault = null;
  return {phase: 'search', search: createSearch(vm, fault)};
}

export function handleFault(vm, error) {
  drive(vm, {phase: 'raise', error: makeFault(error)});
}

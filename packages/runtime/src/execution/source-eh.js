import {popPooledFrame} from './frame-retirement.js';
import {continuationRootValues} from './frame-roots.js';
import {ManagedFault} from '../heap.js';
import {exceptionMatches} from './exception-types.js';

export function frameState() { return {exception: null, caught: [], unwinds: []}; }

/** Exception continuations can own the only live reference to a return value or fault. */
export function* roots(vm) {
  for (const frame of vm.frames) {
    yield* continuationRootValues(frame, true);
  }
  if (vm.fault?.reference) yield vm.fault.reference;
  if (vm.pendingFault?.reference) yield vm.pendingFault.reference;
}

export function makeFault(error) {
  return error instanceof ManagedFault ? error : new ManagedFault('RuntimeException', error?.message ?? String(error));
}

export function enterCatch(vm, frame, handler, fault) {
  const method = vm.image.methods[frame.methodId], after = method.code[handler.end * 3 + 1];
  const siblings = method.handlers.filter(h => h.start === handler.start && h.end === handler.end && h.target > handler.target).sort((a, b) => a.target - b.target);
  const end = siblings[0]?.target ?? after;
  frame.caught = (frame.caught ?? []).filter(c => handler.target >= c.start && handler.target < c.end && c.start !== handler.target);
  frame.caught.push({start: handler.target, end, fault});
  frame.exception = fault;
}

export function finalizers(vm, frame, source, target = Infinity) {
  return vm.image.methods[frame.methodId].handlers
    .filter(h => h.kind === 'finally' && source >= h.start && source <= h.end && !(target >= h.start && target <= h.end))
    .sort((a, b) => (a.end - a.start) - (b.end - b.start));
}

export function finishReturn(vm, frame, value) {
  vm.stack.length = frame.base;
  popPooledFrame(vm);
  if (vm.frames.length) vm.stack.push(value);
  else {
    vm.returnValue = value;
    vm.state = 'terminated';
    vm.exitCode = typeof value === 'number' ? value | 0 : 0;
  }
}

export function transfer(vm, frame, kind, target, value) {
  const handlers = vm.finalizers(frame, frame.pc - 1, target);
  if (!handlers.length) {
    if (kind === 'return') vm.finishReturn(frame, value);
    else frame.pc = target;
    return;
  }
  frame.unwinds.push({kind, target, value, handlers, active: null});
  vm.stack.length = frame.base;
  vm.resumeUnwind(frame);
}

export function resumeUnwind(vm, frame) {
  const unwind = frame.unwinds.at(-1);
  if (!unwind) throw new ManagedFault('InvalidProgramException', 'No active finally continuation');
  if (unwind.handlers.length) {
    unwind.active = unwind.handlers.shift();
    frame.pc = unwind.active.target;
    vm.stack.length = frame.base;
    return;
  }
  frame.unwinds.pop();
  if (unwind.kind === 'return') { vm.finishReturn(frame, unwind.value); return; }
  if (unwind.kind === 'jump') { frame.pc = unwind.target; return; }
  if (unwind.catch) {
    frame.locals[unwind.catch.slot] = unwind.error.reference;
    vm.enterCatch(frame, unwind.catch, unwind.error);
    frame.pc = unwind.catch.target;
    vm.fault = null;
    return;
  }
  popPooledFrame(vm);
  vm.stack.length = frame.base;
  vm.handleFault(unwind.error);
}

export function rethrow(frame) {
  throw [...(frame.caught ?? [])].reverse().find(c => frame.pc - 1 >= c.start && frame.pc - 1 < c.end)?.fault
    ?? new ManagedFault('InvalidOperationException', 'No active exception to rethrow');
}

function matches(vm, fault, type = 'Exception') {
  if (exceptionMatches(fault.name, type)) return true;
  if (!fault.reference) return false;
  const target = vm.heap.methodTables.get(type);
  for (let table = vm.heap.get(fault.reference).methodTable; table; table = table.base) {
    if (table === target) return true;
  }
  return false;
}

export function handleFault(vm, error) {
  const fault = vm.makeFault(error);
  vm.fault = fault;
  if (!fault.reference) {
    try {
      const message = vm.heap.string(fault.message);
      fault.reference = vm.heap.allocate('exception', fault.name, [message], [message]);
    } catch { /* Preserve the original failure if its managed representation cannot be allocated. */ }
  }
  fault.frames ??= vm.frames.slice().reverse().map(f => ({method: vm.image.methods[f.methodId].qualifiedName, point: f.point}));
  while (vm.frames.length) {
    const frame = vm.top, method = vm.image.methods[frame.methodId], pc = frame.pc - 1;
    const handler = method.handlers
      .filter(h => h.kind !== 'finally' && pc >= h.start && pc < h.end && matches(vm, fault, h.type))
      .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    const target = handler?.target ?? Infinity, finals = vm.finalizers(frame, pc, target);
    // Exceptions caught inside the active finally preserve its original continuation.
    frame.unwinds = frame.unwinds.filter(u => u.active && target >= u.active.target && target < u.active.handlerEnd);
    vm.stack.length = frame.base;
    if (finals.length) {
      frame.unwinds.push({kind: 'exception', error: fault, catch: handler, handlers: finals, active: null});
      vm.fault = null;
      vm.resumeUnwind(frame);
      return;
    }
    if (handler) {
      frame.locals[handler.slot] = fault.reference;
      vm.enterCatch(frame, handler, fault);
      frame.pc = handler.target;
      vm.fault = null;
      return;
    }
    popPooledFrame(vm);
  }
  vm.state = 'faulted';
}

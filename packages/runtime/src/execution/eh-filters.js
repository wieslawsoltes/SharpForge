import {
  ManagedFault
} from '../heap.js';
import {
  pushControlFrame as pushFrame,
  retireExceptionFrame as popFrame
} from './control-frames.js';
import {
  nextFrameId
} from './frame-lifetimes.js';
import {
  createExceptionState
} from './exception-state.js';

/** Execute a filter with shared declaring-frame locals while younger frames remain live. */
export function enterFilter(vm, owner, handler, search) {
  if (vm.options.maxFrames !== undefined && vm.frames.length >= vm.options.maxFrames) {
    const fault = new ManagedFault('StackOverflowException', 'Explicit managed filter frame limit exceeded');
    fault.runtimeOrigin = true;
    fault.fatal = true;
    throw fault;
  }
  return pushFrame(vm, {
    id: nextFrameId(vm),
    method: owner.method,
    args: owner.args,
    ...(owner.varargs ? {
      varargs: owner.varargs
    } : {}),
    locals: owner.locals,
    stack: [search.error.reference],
    pc: owner.offsets.get(handler.catchType),
    lastOffset: handler.catchType,
    offsets: owner.offsets,
    ...createExceptionState(),
    needsInitialization: false,
    genericIdentity: owner.genericIdentity ?? null,
    methodArguments: owner.methodArguments ?? [],
    filterSearch: search,
    filterOwnerId: owner.id,
    filterHandler: handler
  });
}

/** A nonzero Int32 selects the catch; an escaping filter exception uses decision zero. */
export function finishFilter(vm, decision) {
  const frame = vm.top;
  const search = frame?.filterSearch;
  if (!search) throw new ManagedFault('InvalidProgramException', 'endfilter outside a filter');
  if (!Number.isInteger(decision) || decision < -2147483648 || decision > 2147483647) {
    throw new ManagedFault('InvalidProgramException', 'endfilter requires an Int32 decision');
  }
  popFrame(vm);
  if (decision !== 0) search.selection = {
    kind: 'catch',
    frameId: frame.filterOwnerId,
    handler: frame.filterHandler
  };
  return search;
}

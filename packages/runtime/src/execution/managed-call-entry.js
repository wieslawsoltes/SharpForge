import {
  ManagedFault
} from '../heap.js';
import {
  instantiatedMethod
} from './generics.js';
import {
  prepareValueReceiver
} from './value-calls.js';
import {
  cilCallFrame,
  admitCallFrame
} from './call-frames.js';
import {
  popPooledFrame
} from './frame-retirement.js';
import {
  enterCilMethod,
  leaveCilMethod
} from './cil-method-events.js';
import {
  eligibleTailCall,
  inheritedTailState
} from './tailcall.js';
import {
  releaseStackFrame,
  admitStackBytes
} from './stack-budget.js';

/** A tail replacement is admitted before retiring the caller, including rollback of byte accounting. */
export function enterManagedCall(vm, token, args, extra = {}) {
  const method = instantiatedMethod(vm, token, extra.genericIdentity ?? null, extra.methodArguments ?? []);
  const caller = vm.top;
  const values = extra.optionalArguments ? [...args, ...extra.optionalArguments.map(item => item.value)] : args;
  const tail = extra.tail === true && eligibleTailCall(caller, values);
  if (vm.frames.length - (tail ? 1 : 0) >= vm.options.maxFrames) {
    throw new ManagedFault('StackOverflowException', 'Managed call depth exceeded');
  }
  if (!method.signature.isStatic && args[0] === null) throw new ManagedFault('NullReferenceException', 'Instance method receiver is null');
  prepareValueReceiver(vm, method, args[0]);
  if (tail) releaseStackFrame(vm, caller);
  let frame;
  try {
    frame = cilCallFrame(vm, method, args, tail ? {
      ...inheritedTailState(caller),
      ...extra
    } : extra);
  } catch (error) {
    if (tail) admitStackBytes(vm, caller);
    throw error;
  }
  if (tail) {
    leaveCilMethod(vm, caller, 'tail');
    popPooledFrame(vm);
  }
  admitCallFrame(vm, frame);
  enterCilMethod(vm, frame);
}

import {ManagedFault} from '../heap.js';
import {admitCilStack} from './frame-stack.js';
import {reserveStackFrame, commitStackFrame, cancelStackFrame} from './stack-budget.js';
import {framePool} from './frame-pool.js';
import {nextFrameId} from './frame-lifetimes.js';
import {methodOffsets} from './method-offsets.js';
import {storageDefault} from './storage.js';
import {initializeFloatFrame} from './typed-float-frame.js';
import {admitCallFrame} from './call-frames.js';
import {enterCilMethod} from './cil-method-events.js';
import {hasCanonicalCilCall} from './call-entry-guard.js';
import {cilFrameCapability} from './cil-frame-capability.js';

/** Ordinary closed class targets can copy directly from rooted caller storage. */
export function preparedCilTarget(vm, token, extra) {
  if (!hasCanonicalCilCall(vm) || extra.genericIdentity || extra.methodArguments?.length) return null;
  const method = vm.inspector.getMethod(token), signature = method.signature;
  if (signature.isStatic || signature.genericArity || signature.callingConvention || signature.explicitThis ||
      signature.sentinel != null || method.name === '.ctor' || method.name === '.cctor') return null;
  const owner = vm.typeSystem.table(method.ownerToken);
  if (owner.flags.valueType || owner.flags.interface || owner.genericArity || owner.containsGenericParameters) return null;
  return Object.freeze({method, frameCapability: cilFrameCapability(vm.inspector, method, signature.parameters.length + 1)});
}

/** Admission and observer order match enterManagedCall; no scratch argument array escapes or is allocated. */
export function enterPreparedCilFrame(vm, prepared, stack, start, count, extra) {
  const method = prepared.method;
  let pool, frame, ticket;
  try {
    if (vm.frames.length >= vm.options.maxFrames) {
      throw new ManagedFault('StackOverflowException', 'Managed call depth exceeded');
    }
    const capacity = admitCilStack(vm, method);
    ticket = reserveStackFrame(vm, method, count);
    pool = framePool(vm);
    frame = pool.acquireCil(prepared.frameCapability);
    frame.id = nextFrameId(vm);
    frame.method = method;
    frame.offsets = methodOffsets(method);
    frame.needsInitialization = true;
    frame.args[0] = stack[start];
    for (let index = 1; index < count; index++) frame.args[index] = vm.storage(stack[start + index], method.signature.parameters[index - 1]);
    for (let index = 0; index < method.locals.length; index++) {
      frame.locals[index] = method.initLocals ? storageDefault(vm, method.locals[index]) : undefined;
    }
    frame.genericIdentity = extra.genericIdentity;
    frame.methodArguments = extra.methodArguments;
    initializeFloatFrame(vm, frame, capacity);
    commitStackFrame(ticket, frame);
    admitCallFrame(vm, frame);
  } catch (error) {
    cancelStackFrame(ticket);
    if (frame) pool.retire(frame);
    throw error;
  } finally {
    // Until admission succeeds these values are live evaluation-stack roots, including during normalization.
    stack.length = start;
  }
  enterCilMethod(vm, frame);
}

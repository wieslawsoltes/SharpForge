import {callSignatureKey} from '@sharpforge/cil';
import {ManagedFault} from '../../heap.js';
import {cachedMetadataToken} from '../token-cache.js';
import {methodPointerSignature} from '../method-pointers.js';
import {framePool} from '../frame-pool.js';

/** Resolve and validate before consuming operands; canonical calls own frame, GC and initializer behavior. */
export function indirectCall(vm, frame, instruction) {
  const signature = cachedMetadataToken(vm, instruction.operand).signature;
  if (signature.callingConvention || !signature.isStatic || signature.genericArity) {
    const fault = new ManagedFault('NotSupportedException', 'Only managed static nongeneric calli is executable');
    fault.member = frame.method.owner + '::' + frame.method.name;
    fault.callingConvention = signature.callingConvention ?? 0;
    throw fault;
  }
  const pointer = frame.stack.at(-1), target = methodPointerSignature(vm, pointer);
  if (callSignatureKey(signature) !== callSignatureKey(target)) {
    throw new ManagedFault('InvalidProgramException', 'Managed calli signature mismatch');
  }
  if (frame.stack.length < signature.parameters.length + 1) {
    throw new ManagedFault('InvalidProgramException', 'calli argument stack underflow');
  }
  // PrepareCall on the selected frame gates its precise initializer before pc 0.
  frame.stack.pop();
  const pool = framePool(vm), args = pool.arguments(frame.stack, signature.parameters.length);
  try { vm.heap.withRoots(args, () => vm.call(pointer.token, args)); }
  finally { pool.releaseArguments(args); }
}

export const handlers = new Map([['calli', indirectCall]]);

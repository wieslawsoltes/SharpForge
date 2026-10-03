import {instantiateSignature, callSignatureKey} from '@sharpforge/cil';
import {ManagedFault} from '../../heap.js';
import {SUSPENDED} from '../suspension.js';

/** Execute verified managed pointers; runtime branding also protects host-injected values. */
export function indirectCall(vm, frame, instruction) {
  const signature = instantiateSignature(vm.inspector.signature(instruction.operand), frame.method.typeArguments, frame.methodArguments);
  if (signature.callingConvention) {
    const fault = new ManagedFault('NotSupportedException', `Unmanaged calli in ${frame.method.owner}::${frame.method.name}`);
    fault.member = frame.method.owner + '::' + frame.method.name;
    fault.callingConvention = signature.callingConvention;
    throw fault;
  }
  const pointer = frame.stack.at(-1);
  const count = signature.parameters.length + (signature.isStatic ? 0 : 1);
  if (!pointer?.methodPointer || pointer.vmOwner !== vm.snapshotOwner ||
      callSignatureKey(signature) !== callSignatureKey(pointer.signature)) {
    throw new ManagedFault('InvalidProgramException', 'Managed calli signature mismatch');
  }
  if (frame.stack.length < count + 1) throw new ManagedFault('InvalidProgramException', 'calli argument stack underflow');
  frame.stack.pop();
  const args = frame.stack.splice(frame.stack.length - count, count);
  const tail = !!frame.tailCall;
  frame.tailCall = false;
  return vm.heap.withRoots(args, () => {
    const result = vm.invokeFunctionPointer(pointer, args, {tail});
    if (result !== SUSPENDED && signature.returnType !== 'void') frame.stack.push(result);
  });
}

export const handlers = new Map([['calli', indirectCall]]);

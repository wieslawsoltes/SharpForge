import {invokeIntrinsic} from './intrinsics.js';
import {SUSPENDED} from '../platform.js';

/** A builtin may synchronously stop execution; never write its result into a retired caller frame. */
export function pushIntrinsicCallResult(vm, caller, descriptor, args, isVirtual) {
  const result = invokeIntrinsic(vm, descriptor, args, isVirtual);
  const value = vm.state === 'terminated' ? SUSPENDED : result;
  if (descriptor.signature.returnType !== 'void' && value !== SUSPENDED) caller.stack.push(value);
}

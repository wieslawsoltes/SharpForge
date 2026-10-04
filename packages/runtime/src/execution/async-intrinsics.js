import {ManagedFault} from './managed-fault.js';
import {invokeAsyncIntrinsic} from './async-runtime.js';

/** Both ABI entry points use the same builder, value-storage, and scheduler lifecycle. */
export function invokeAsync(vm, descriptor, args) {
  const result = invokeAsyncIntrinsic(vm, descriptor, args);
  if (!result.handled) throw new ManagedFault('InvalidProgramException', 'Unregistered async ABI member');
  return result.value;
}

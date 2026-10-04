import {invokeExceptionEvent} from './exception-events.js';
import {invokeDelegateOperation} from './delegate-invocations.js';

/** Runtime control contracts share the existing owned delegate and event protocols. */
export function invokeControl(vm, descriptor, args) {
  if (descriptor.kind !== 'delegateOperation' || descriptor.owner !== 'System.Delegate')
    return invokeExceptionEvent(vm, descriptor, args);
  const value = invokeDelegateOperation(vm, descriptor, args);
  return {handled: true, value: descriptor.result === 'bool' && !vm.inspector ? !!value : value};
}

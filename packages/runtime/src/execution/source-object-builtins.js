import {ManagedFault, isReference} from '../heap.js';
import {beginObjectEquals, beginObjectHashCode} from './object-value-operation.js';
import {objectToString} from './object-method-call.js';
import {SUSPENDED} from '../suspension.js';

/** Source Object calls use managed references; legacy scalar ToString retains its released formatting carrier. */
export function sourceObjectBuiltin(vm, name, args) {
  const receiver = args[0];
  if (receiver === null) throw new ManagedFault('NullReferenceException', 'Object receiver is null');
  if (name === 'object.ToString') return isReference(receiver) ? objectToString(vm, receiver) : vm.heap.string(vm.format(receiver));
  if (name === 'object.Equals') {
    const result = beginObjectEquals(vm, receiver, args[1]);
    return result === SUSPENDED ? result : !!result;
  }
  return beginObjectHashCode(vm, receiver);
}

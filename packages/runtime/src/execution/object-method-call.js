import {ManagedFault} from '../heap.js';
import {SUSPENDED} from '../suspension.js';
import {verifiedMethod} from './token-cache.js';
import {objectCallOwner} from './object-call-owner.js';
import {objectOverride} from './object-dispatch.js';
import {objectValueRecord} from './object-scalar-values.js';
import {invokeFrameworkObjectToString} from './framework-object-string.js';
import {isNumber} from './numeric-ops.js';
import {isDecimal} from './decimal.js';

/** Both interpreters enter the existing managed frame lifecycle with the receiver's exact runtime owner. */
export function callObjectOverride(vm, target, type, reference, args, extra = {}) {
  if (vm.inspector && !verifiedMethod(vm, target)) {
    throw new ManagedFault('NotSupportedException', 'Unverified Object override');
  }
  const genericIdentity = objectCallOwner(vm, target, type, reference);
  vm.call(target, args, {genericIdentity, ...extra});
  return SUSPENDED;
}

/** ToString returns a managed string through the ordinary return path, with no synchronous nested execution. */
export function objectToString(vm, receiver, virtual = true) {
  if (receiver === null) throw new ManagedFault('NullReferenceException', 'Object receiver is null');
  if (isNumber(receiver) || typeof receiver === 'boolean' || isDecimal(receiver)) return vm.heap.string(vm.format(receiver));
  const record = objectValueRecord(vm, receiver), type = record.methodTable;
  if (virtual) {
    const framework = invokeFrameworkObjectToString(vm.platform, receiver);
    if (framework.handled) return framework.value;
  }
  const target = virtual ? objectOverride(vm, type, 'ToString') : null;
  if (target !== null) return callObjectOverride(vm, target, type, receiver,
    [type.flags.valueType ? vm.address('box', 0, receiver) : receiver], {objectStringReturn: true});
  return record.kind === 'string' ? receiver : vm.heap.string(vm.format(receiver));
}

import {SUSPENDED} from '../suspension.js';
import {copyNullable} from './nullable-value.js';
import {boxValue} from './boxing.js';
import {objectOverride} from './object-dispatch.js';
import {callObjectOverride} from './object-method-call.js';
import {validatePointer} from './control-pointers.js';
import {NullableValueStep} from './nullable-interior.js';

/** Nullable.ToString invokes mutable payload overrides through the original writable receiver. */
export function nullableToString(vm, receiver, type) {
  const location = receiver?.byref ? validatePointer(vm, receiver) : null;
  const value = copyNullable(vm, location ? vm.dereference(receiver) : receiver, type);
  if (!value.hasValue) return vm.heap.string('');
  const element = value.nullableType.nullableType, target = objectOverride(vm, element, 'ToString');
  if (target === null) return vm.heap.string(vm.format(value.value, element.name));
  let payload, box = null;
  if (location && !location.readonly) payload = vm.address('field', NullableValueStep, receiver);
  else {
    // Rvalues and readonly receivers cannot expose their original storage to a mutating override.
    box = boxValue(vm, value.value, element);
    payload = vm.heap.withRoots([box], () => vm.address('box', 0, box));
  }
  return vm.heap.withRoots([payload, box], () => callObjectOverride(vm, target, element, box, [payload], {objectStringReturn: true}));
}

export function pushNullableText(vm, receiver, type) {
  const result = nullableToString(vm, receiver, type);
  if (result !== SUSPENDED) vm.stack.push(result);
}

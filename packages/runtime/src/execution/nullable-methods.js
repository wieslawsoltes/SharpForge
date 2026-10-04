import {SUSPENDED} from '../suspension.js';
import {copyNullable} from './nullable-value.js';
import {boxValue} from './boxing.js';
import {objectOverride} from './object-dispatch.js';
import {callObjectOverride} from './object-method-call.js';
import {validatePointer} from './control-pointers.js';
import {NullableValueStep} from './nullable-interior.js';
import {beginObjectEquals, beginObjectHashCode} from './object-value-operation.js';
import {objectValueRecord} from './object-scalar-values.js';

function nullableReceiver(vm, receiver, type) {
  const location = receiver?.byref ? validatePointer(vm, receiver) : null;
  const value = copyNullable(vm, location ? vm.dereference(receiver) : receiver, type);
  return {location, value, element: value.nullableType.nullableType};
}

function invokePayload(vm, receiver, {location, value, element}, target, args, extra = {}) {
  let payload, box = null;
  if (location && !location.readonly) payload = vm.address('field', NullableValueStep, receiver);
  else {
    // Rvalues and readonly receivers cannot expose their original storage to a mutating override.
    box = boxValue(vm, value.value, element);
    payload = vm.heap.withRoots([box], () => vm.address('box', 0, box));
  }
  return vm.heap.withRoots([payload, box, ...args], () => callObjectOverride(vm, target, element, box, [payload, ...args], extra));
}

/** Nullable Object overrides use the writable payload, or a defensive copy for readonly/rvalue receivers. */
export function nullableToString(vm, receiver, type) {
  const context = nullableReceiver(vm, receiver, type), {value, element} = context;
  if (!value.hasValue) return vm.heap.string('');
  const target = objectOverride(vm, element, 'ToString');
  return target === null ? vm.heap.string(vm.format(value.value, element.name))
    : invokePayload(vm, receiver, context, target, [], {objectStringReturn: true});
}

export function nullableEquals(vm, receiver, type, other) {
  const context = nullableReceiver(vm, receiver, type), {value, element} = context;
  const record = other === null ? null : objectValueRecord(vm, other);
  if (!value.hasValue) return Number(other === null);
  if (other === null) return 0;
  const target = objectOverride(vm, element, 'Equals');
  if (target !== null) return invokePayload(vm, receiver, context, target, [other]);
  if (record.kind !== 'box' || record.methodTable !== element) return 0;
  return beginObjectEquals(vm, value.value, record.data[0], {type: element, defaultOnly: true});
}

export function nullableHashCode(vm, receiver, type) {
  const context = nullableReceiver(vm, receiver, type), {value, element} = context;
  if (!value.hasValue) return 0;
  const target = objectOverride(vm, element, 'GetHashCode');
  return target === null ? beginObjectHashCode(vm, value.value, {type: element, defaultOnly: true})
    : invokePayload(vm, receiver, context, target, []);
}

export function pushNullableText(vm, receiver, type) {
  const result = nullableToString(vm, receiver, type);
  if (result !== SUSPENDED) vm.stack.push(result);
}

import {
  writeExceptionSlot
} from './exception-object.js';
import {
  ManagedFault,
  isReference
} from '../heap.js';
import {
  referenceEquals
} from './strings.js';

function keyEquals(vm, left, right) {
  if (referenceEquals(left, right)) return true;
  if (!isReference(left) || !isReference(right)) return false;
  const first = vm.heap.get(left);
  const second = vm.heap.get(right);
  if (first.kind === 'string' && second.kind === 'string') return first.data === second.data;
  if (first.kind === 'box' && second.kind === 'box' && first.methodTable === second.methodTable) {
    return Object.is(first.data[0], second.data[0]);
  }
  return false;
}

/** Small managed IDictionary backing Exception.Data; keys and values are GC-visible slots. */
export function exceptionDataCall(vm, reference, name, args) {
  const record = vm.heap.get(reference);
  if (record.kind !== 'exception-data') throw new ManagedFault('ArgumentException', 'Exception.Data dictionary required');
  if (name === 'get_Count') return record.data.length / 2;
  if (name === 'Clear') {
    vm.heap.replaceData(reference, []);
    return null;
  }
  const [key, value] = args;
  if (key === null) throw new ManagedFault('ArgumentNullException', 'key');
  let index = -1;
  for (let current = 0; current < record.data.length; current += 2) {
    if (keyEquals(vm, record.data[current], key)) {
      index = current;
      break;
    }
  }
  if (name === 'get_Item') return index < 0 ? null : record.data[index + 1];
  if (name === 'Contains') return index >= 0 ? 1 : 0;
  if (name === 'Remove') {
    if (index >= 0) vm.heap.replaceData(reference, [...record.data.slice(0, index), ...record.data.slice(index + 2)]);
    return null;
  }
  if (name !== 'Add' && name !== 'set_Item') throw new ManagedFault('MissingMethodException', name);
  if (name === 'Add' && index >= 0) throw new ManagedFault('ArgumentException', 'The key already exists');
  if (index < 0) vm.heap.replaceData(reference, [...record.data, key, value]);
  else writeExceptionSlot(vm, reference, index + 1, value);
  return null;
}

import {ManagedFault} from '../heap.js';
import {ownsHeapReference} from './heap-reference.js';

/** Object.ToString callbacks return exactly a managed string or null on both invocation paths. */
export function requireObjectStringResult(vm, value) {
  if (value !== null && (!ownsHeapReference(vm.heap, value) || vm.heap.get(value).kind !== 'string')) {
    throw new ManagedFault('InvalidProgramException', 'Object.ToString override did not return a managed string or null');
  }
  return value;
}

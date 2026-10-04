import {framePool} from './frame-pool.js';
import {SUSPENDED} from '../suspension.js';
import {nullableToString, nullableEquals, nullableHashCode} from './nullable-methods.js';

const operations = Object.freeze({ToString: nullableToString, Equals: nullableEquals, GetHashCode: nullableHashCode});

/** The caller has already checked the exact Object declaration and owned Nullable receiver storage. */
export function invokeConstrainedNullable(vm, caller, descriptor, table) {
  const pool = framePool(vm);
  const args = pool.arguments(caller.stack, descriptor.signature.parameters.length + 1);
  try {
    // The payload address may be the last root of a field/array/box owner during a managed override.
    vm.heap.withRoots(args, () => {
      const result = operations[descriptor.name](vm, args[0], table, args[1]);
      if (result !== SUSPENDED) caller.stack.push(result);
    });
  } finally {
    pool.releaseArguments(args);
  }
  return true;
}

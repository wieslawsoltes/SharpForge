import {ManagedFault} from '../heap.js';
import {beginArrayOperation} from './array-continuations.js';
export {arrayWorkQuantum, validateArrayContinuation, resumeArrayOperation,
  cancelArrayOperation, arrayContinuationRoots} from './array-continuations.js';

/** Shared source/CIL in-place ordering with bounded work and no array-sized scratch copy. */
export function mutateArray(vm, name, reference) {
  if (reference === null) throw new ManagedFault('ArgumentNullException', 'Array cannot be null');
  const record = vm.heap.get(reference);
  if (record.kind !== 'array') throw new ManagedFault('ArgumentException', 'Array required');
  if (record.methodTable.rank > 1) throw new ManagedFault('RankException', 'Array ordering requires one dimension');
  if (!['Sort', 'Reverse'].includes(name)) throw new ManagedFault('MissingMethodException', 'Unsupported array operation');
  const length = record.data.length;
  if (length < 2) return null;
  return beginArrayOperation(vm, {operation: name, reference, destination: reference, length,
    phase: 'build', buildIndex: Math.floor(length / 2) - 1, root: 0, sifting: false, end: length - 1});
}

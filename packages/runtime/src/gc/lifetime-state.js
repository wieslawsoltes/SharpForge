import {ManagedFault} from './fault.js';
import {isReference} from './reference.js';

export function sameReference(left, right) {
  return isReference(left) && isReference(right) && left.h === right.h && left.g === right.g;
}

export function liveReference(heap, reference) {
  return isReference(reference) && heap.generations[reference.h] === reference.g && !!heap.records[reference.h];
}

export function noteLifetimeMutation(heap) {
  if (heap.noteMutation) heap.noteMutation();
  else heap.mutationRevision++;
}

export function lifetimeFault(message) {
  return new ManagedFault('InvalidOperationException', message);
}

export function positiveBudget(value, name, maximum = 10000000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

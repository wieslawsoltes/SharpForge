import {ManagedFault} from './heap.js';
/** Clone mutable execution state while retaining frozen references and fault aliases. */
export function copyExecution(value, memo = new Map()) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (memo.has(value)) return memo.get(value);
  if (value instanceof ManagedFault) {
    const copy = new ManagedFault(value.name, value.message, value.reference); memo.set(value, copy);
    for (const key of Object.keys(value)) copy[key] = copyExecution(value[key], memo);
    return copy;
  }
  const copy = Array.isArray(value) ? [] : {}; memo.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = copyExecution(item, memo);
  return copy;
}

import {ManagedFault} from './managed-fault.js';

export const snapshotInteger = value => Number.isSafeInteger(value) && value >= 0;
export const terminalContext = status => status === 'completed' || status === 'faulted' || status === 'canceled';

export function invalidSnapshot(part) {
  throw new TypeError('Invalid snapshot ' + part);
}

export function snapshotPairs(values, part) {
  if (!Array.isArray(values)) invalidSnapshot(part);
  const keys = new Set();
  for (const row of values) {
    if (!Array.isArray(row) || row.length !== 2 || keys.has(row[0])) invalidSnapshot(part + ' entries');
    keys.add(row[0]);
  }
}

export function snapshotFault(value) {
  if (value !== null && value !== undefined &&
      (!(value instanceof ManagedFault) || typeof value.name !== 'string' || typeof value.message !== 'string')) {
    invalidSnapshot('fault');
  }
}

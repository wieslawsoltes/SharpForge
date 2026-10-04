import {formatDefaultNumber} from './double-format.js';

/**
 * Format invariant default Single text from a raw JavaScript number already rounded to binary32.
 * Signed zero, NaN and infinities are accepted. Callers unwrap CLI carriers and perform storage
 * conversion; this pure helper does not coerce inputs or allocate managed memory.
 */
export function formatSingleDefault(value) {
  if (!Number.isFinite(value) || value === 0) return formatDefaultNumber(value, 9);
  for (let precision = 1; precision <= 9; precision++) {
    const rounded = Number(value.toPrecision(precision));
    if (Math.fround(rounded) === value) return formatDefaultNumber(rounded, 9);
  }
  return formatDefaultNumber(value, 9);
}

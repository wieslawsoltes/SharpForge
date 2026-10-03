import {ManagedFault} from './fault.js';

export const INT64_MAX = (1n << 63n) - 1n;

/** Validate a managed Int32 value in an inclusive range. */
export function gcInteger(value, name, minimum = 0, maximum = 2147483647) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ManagedFault('ArgumentOutOfRangeException', `${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

/** Accept source booleans and CLI bool stack values without accepting arbitrary integers. */
export function gcBoolean(value, name) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new ManagedFault('ArgumentException', `${name} must be Boolean`);
}

/** Validate exact nonnegative Int64 byte counts; unsafe JavaScript numbers are rejected. */
export function gcBytes(value, name, allowZero = false) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = BigInt(value);
  if (typeof value !== 'bigint' || value < (allowZero ? 0n : 1n) || value > INT64_MAX) {
    throw new ManagedFault('ArgumentOutOfRangeException', `${name} must be ${allowZero ? 'a nonnegative' : 'a positive'} Int64`);
  }
  return value;
}

/** Preserve exact Int64 accounting; malformed internal counters are invariant failures. */
export function gcInt64(value = 0) {
  if (typeof value === 'bigint' && value >= 0n && value <= INT64_MAX) return value;
  if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new ManagedFault('OverflowException', 'GC counter cannot be represented exactly as Int64');
}

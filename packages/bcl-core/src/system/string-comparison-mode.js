import {fail} from '../host.js';

/** Validate the enum independently of operation-specific argument checks and culture support. */
export function validateStringComparisonMode(platform, mode) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 5) {
    fail(platform, 'ArgumentException', "Invalid string comparison type. (Parameter 'comparisonType')");
  }
}

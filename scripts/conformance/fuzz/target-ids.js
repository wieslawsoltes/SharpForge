import { TARGET_IDS, validateTargetId } from './budgets.js';

/** Reviewed offline adapters; input data never selects a module or executable. */
export const targetIds = TARGET_IDS;

export function requireTargetId(value) {
  return validateTargetId(value);
}

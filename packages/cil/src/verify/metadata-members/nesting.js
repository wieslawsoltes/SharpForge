import { rejectMember } from './budget.js';
import { snapshotMetadataNesting } from '../metadata-nesting.js';

export { maxNestingDepth } from '../metadata-nesting.js';
export const maxAccessChecks = 4096;

/** Preserve member diagnostics while sharing lexical forest validation with type resolution. */
export function snapshotNesting(rows, visibility, budget) {
  return snapshotMetadataNesting(rows, visibility, {
    check: budget.check,
    invalid: detail => rejectMember('CILVM0001', detail),
    limit: detail => rejectMember('CILVM0002', detail),
  });
}

import { createMetadataVerificationTypeSystem } from './type-system.js';
import { memberBudget } from './metadata-members/budget.js';
import { snapshotMembers } from './metadata-members/snapshot.js';
import { memberQueries } from './metadata-members/resolve.js';

export { verificationMemberDiagnosticCatalog } from './metadata-members/budget.js';

/**
 * Extend the metadata type adapter with canonical field/method declaration resolution.
 * Bounded snapshots own their metadata; unresolved external or unsupported references return unknown.
 */
export function createMetadataVerificationContext(inspector, options = {}) {
  const types = createMetadataVerificationTypeSystem(inspector, options);
  const budget = memberBudget(options);
  const members = memberQueries(snapshotMembers(inspector, budget), types, budget);
  return Object.freeze({ ...types, resolveMember: members.resolveMember });
}

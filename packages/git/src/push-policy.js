import { GitError } from './errors.js';
import { collectAncestors } from './remote-graph.js';
import { getObjectFormat } from './object-format.js';
import { validateRefName } from './refs/names.js';

/** Validate advertised old IDs, ancestry and an explicitly verified authorization token before uploading. */
export async function validatePushPolicy({ odb, updates, remoteRefs, algorithm = 'sha1', signal,
  force = false, leases = {}, confirmation, verifyConfirmation }) {
  const advertised = new Map(remoteRefs.map(ref => [ref.name, ref.oid]));
  const zero = getObjectFormat(algorithm).zeroOid;
  const validated = [];
  for (const update of updates) {
    validateRefName(update.name);
    const current = advertised.get(update.name) ?? null;
    const expected = update.oldOid === zero ? null : update.oldOid;
    if (expected !== undefined && expected !== current) {
      throw new GitError('Conflict', 'Remote reference changed before push', { name: update.name, expected, actual: current });
    }
    const newOid = update.newOid === zero ? null : update.newOid;
    const hasLease = Object.hasOwn(leases, update.name);
    if (hasLease && leases[update.name] !== current) {
      throw new GitError('Conflict', 'Force-with-lease expected a different remote ID', { name: update.name, expected: leases[update.name], actual: current });
    }
    let fastForward = !current || !newOid || current === newOid;
    if (!fastForward && update.name.startsWith('refs/heads/')) {
      const ancestors = await collectAncestors({ odb, tips: [newOid], algorithm, signal });
      fastForward = ancestors.has(current);
    }
    if (!fastForward) {
      if (!force && !hasLease) throw new GitError('Conflict', 'Push is not a fast-forward', { name: update.name, current, newOid });
      if (!confirmation || !verifyConfirmation || !await verifyConfirmation(confirmation, {
        action: hasLease ? 'force-with-lease' : 'force-push', ref: update.name, expected: current, newOid
      })) throw new GitError('Auth', 'Force push requires a verified confirmation token', { name: update.name });
    }
    validated.push({ ...update, oldOid: current, newOid });
  }
  return validated;
}

import { GitError } from './errors.js';
import { pushRemote } from './push.js';
import { validateRefName } from './refs/names.js';

export function remoteRefName(name, kind = 'branch') {
  if (!['branch', 'tag'].includes(kind)) throw new GitError('Unsupported', 'Unknown remote reference kind');
  const prefix = kind === 'tag' ? 'refs/tags/' : 'refs/heads/';
  const ref = name.startsWith('refs/') ? name : `${prefix}${name}`;
  validateRefName(ref);
  if (!ref.startsWith(prefix)) throw new GitError('Unsafe', 'Remote reference kind does not match its namespace');
  return ref;
}

/** Create/update remote branches or tags using the same ancestry, lease and report-status policy as push. */
export function setRemoteRef({ name, kind = 'branch', oid, expected, ...options }) {
  const ref = remoteRefName(name, kind);
  return pushRemote({ ...options, updates: [{ name: ref, newOid: oid, ...(expected !== undefined ? { oldOid: expected } : {}) }] });
}

/** Deletions remain old-ID guarded and preserve protected-branch provider messages in typed errors. */
export function deleteRemoteRef({ name, kind = 'branch', expected, ...options }) {
  const ref = remoteRefName(name, kind);
  return pushRemote({ ...options, updates: [{ name: ref, newOid: null, ...(expected !== undefined ? { oldOid: expected } : {}) }] });
}

export function mapProtectedRefError(error, { provider, ref } = {}) {
  if (error instanceof GitError && ['Conflict', 'Auth'].includes(error.code)) {
    return new GitError(error.code, error.message, { ...error.details, provider, ref, ruleMessage: error.details.ruleMessage ?? error.details.remoteMessage });
  }
  return GitError.from(error);
}

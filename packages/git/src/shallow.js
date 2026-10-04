import { GitError, checkLimit } from './errors.js';
import { validateWireOid } from './protocol/advertisement.js';
import { encodeText, decodeText, protocolField } from './protocol/bytes.js';

/** Validate shallow negotiation and return protocol arguments, preserving the existing boundary set. */
export function shallowArguments({ shallow = [], depth, since, exclude = [], relative = false, unshallow = false, algorithm = 'sha1' }) {
  const lines = [...shallow].map(oid => `shallow ${validateWireOid(oid, algorithm)}`);
  if (unshallow && (depth !== undefined || since !== undefined || exclude.length)) {
    throw new GitError('Conflict', 'Unshallow cannot be combined with another depth constraint');
  }
  if (depth !== undefined) {
    checkLimit(depth, 0x7fffffff, 'Fetch depth');
    if (depth === 0) throw new GitError('Corrupt', 'Fetch depth must be positive');
    if (since !== undefined || exclude.length) throw new GitError('Conflict', 'Depth cannot be combined with since or excluded refs');
    lines.push(`deepen ${depth}`);
  }
  if (unshallow) lines.push('deepen 2147483647');
  if (relative) {
    if (depth === undefined) throw new GitError('Corrupt', 'Relative deepening requires a depth');
    lines.push('deepen-relative');
  }
  if (since !== undefined) lines.push(`deepen-since ${checkLimit(since, Number.MAX_SAFE_INTEGER, 'Shallow timestamp')}`);
  for (const ref of exclude) lines.push(`deepen-not ${protocolField(ref, 'Excluded ref')}`);
  return lines;
}

export function parseShallow(bytes, { algorithm = 'sha1' } = {}) {
  const lines = bytes ? decodeText(bytes).split('\n').filter(Boolean) : [];
  return new Set(lines.map(oid => validateWireOid(oid, algorithm)));
}

export function encodeShallow(shallow, { algorithm = 'sha1' } = {}) {
  const oids = [...new Set(shallow)].sort();
  for (const oid of oids) validateWireOid(oid, algorithm);
  return encodeText(oids.length ? `${oids.join('\n')}\n` : '');
}

/** Publish boundary changes only after the associated pack is verified and installed. */
export async function updateShallow(store, { add = [], remove = [], algorithm = 'sha1', signal } = {}) {
  return store.transaction(async transaction => {
    const shallow = parseShallow(await transaction.get('shallow', { signal }), { algorithm });
    for (const oid of add) shallow.add(validateWireOid(oid, algorithm));
    for (const oid of remove) {
      validateWireOid(oid, algorithm);
      if (!shallow.delete(oid)) throw new GitError('Corrupt', 'Server unshallowed a commit outside the local boundary', { oid });
    }
    if (shallow.size) await transaction.set('shallow', encodeShallow(shallow, { algorithm }));
    else await transaction.delete('shallow');
    return shallow;
  }, { signal });
}

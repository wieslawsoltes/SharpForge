import { GitError } from '../errors.js';
import { validateObjectId } from '../odb.js';
import { formatIdentity } from '../objects.js';

function identityText(identity, clock) {
  if (typeof identity === 'string') return formatIdentity(identity);
  const name = identity?.name ?? 'SharpForge';
  const email = identity?.email ?? 'sharpforge@localhost';
  const timestamp = identity?.timestamp ?? clock();
  let timezone = identity?.timezone ?? '+0000';
  if (identity?.timezoneOffset !== undefined) {
    const minutes = identity.timezoneOffset;
    if (!Number.isInteger(minutes) || Math.abs(minutes) > 1439) throw new GitError('Corrupt', 'Invalid reflog timezone offset');
    timezone = `${minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}`;
    timezone += String(Math.abs(minutes) % 60).padStart(2, '0');
  }
  return formatIdentity({ name, email, timestamp, timezone });
}

/** Encode one native Git reflog record; timestamps are Unix seconds. */
export function serializeReflogEntry({ oldOid, newOid, identity, message = '' },
  { algorithm = 'sha1', clock = () => Math.floor(Date.now() / 1000) } = {}) {
  const zero = '0'.repeat(algorithm === 'sha256' ? 64 : 40);
  const oldValue = validateObjectId(oldOid ?? zero, algorithm);
  const newValue = validateObjectId(newOid ?? zero, algorithm);
  if (typeof message !== 'string' || /[\r\n\x00]/u.test(message)) throw new GitError('Unsafe', 'Reflog message must be one line');
  return `${oldValue} ${newValue} ${identityText(identity, clock)}\t${message}\n`;
}

export function parseReflog(text, { algorithm = 'sha1' } = {}) {
  return text.split(/\r?\n/u).filter(Boolean).map(line => {
    const match = /^([0-9a-f]+) ([0-9a-f]+) (.*) <([^<>]*)> (-?\d+) ([+-]\d{4})\t(.*)$/u.exec(line);
    if (!match) throw new GitError('Corrupt', 'Malformed reflog entry');
    const timestamp = Number(match[5]);
    if (!Number.isSafeInteger(timestamp)) throw new GitError('Corrupt', 'Invalid reflog timestamp');
    return { oldOid: validateObjectId(match[1], algorithm), newOid: validateObjectId(match[2], algorithm),
      identity: { name: match[3], email: match[4], timestamp, timezone: match[6] }, message: match[7] };
  });
}

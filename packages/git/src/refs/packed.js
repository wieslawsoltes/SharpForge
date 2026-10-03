import { GitError, checkLimit } from '../errors.js';
import { validateObjectId } from '../odb.js';
import { validateRefName } from './names.js';

/** Parse packed-refs, including annotated-tag peeled records. */
export function parsePackedRefs(text, { algorithm = 'sha1', maxRefs = 1000000 } = {}) {
  if (typeof text !== 'string') throw new TypeError('packed-refs must be text');
  const entries = new Map();
  let previous;
  for (const line of text.split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('^')) {
      if (!previous || previous.peeled) throw new GitError('Corrupt', 'Orphan or repeated packed-ref peeled value');
      previous.peeled = validateObjectId(line.slice(1), algorithm);
      continue;
    }
    const separator = line.indexOf(' ');
    if (separator < 0) throw new GitError('Corrupt', 'Malformed packed reference');
    const oid = validateObjectId(line.slice(0, separator), algorithm);
    const name = validateRefName(line.slice(separator + 1));
    if (!name.startsWith('refs/') || entries.has(name)) throw new GitError('Corrupt', 'Duplicate or invalid packed reference', { name });
    previous = { name, oid };
    entries.set(name, previous);
    checkLimit(entries.size, maxRefs, 'Packed reference count');
  }
  return [...entries.values()];
}

export function serializePackedRefs(entries, { algorithm = 'sha1' } = {}) {
  const ordered = [...entries].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const lines = ['# pack-refs with: peeled sorted'];
  let previous;
  for (const { name, oid, peeled } of ordered) {
    validateRefName(name);
    if (!name.startsWith('refs/') || name === previous) throw new GitError('Corrupt', 'Duplicate or invalid packed reference', { name });
    lines.push(`${validateObjectId(oid, algorithm)} ${name}`);
    if (peeled) lines.push(`^${validateObjectId(peeled, algorithm)}`);
    previous = name;
  }
  return `${lines.join('\n')}\n`;
}

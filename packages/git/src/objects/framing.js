import { GitError, checkLimit } from '../errors.js';
import { asBytes, concatenateBytes } from '../hash/bytes.js';

export const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
export const GitObjectType = Object.freeze({ Blob: 'blob', Tree: 'tree', Commit: 'commit', Tag: 'tag' });
const objectTypes = new Set(Object.values(GitObjectType));
const encoder = new TextEncoder();

/** Validate Git's four stored object types and produce its canonical ASCII header. */
export function objectHeader(type, size, maximum = MAX_OBJECT_BYTES) {
  if (!objectTypes.has(type)) throw new GitError('Corrupt', 'Invalid Git object type', { type });
  checkLimit(size, maximum, 'Git object size');
  return encoder.encode(`${type} ${size}\0`);
}

/** Serialize a loose object's uncompressed header and body. The input is not mutated. */
export function serializeObject(type, input, { maxObjectBytes = MAX_OBJECT_BYTES } = {}) {
  const data = asBytes(input);
  const header = objectHeader(type, data.length, maxObjectBytes);
  return concatenateBytes([header, data]);
}

/** Parse strict canonical object framing; reject unknown types, nondecimal sizes and trailing bytes. */
export function parseObject(input, { maxObjectBytes = MAX_OBJECT_BYTES } = {}) {
  const raw = asBytes(input);
  const terminator = raw.indexOf(0);
  if (terminator < 0 || terminator > 64) throw new GitError('Corrupt', 'Invalid Git object header');
  const header = String.fromCharCode(...raw.subarray(0, terminator));
  const match = /^(blob|tree|commit|tag) (0|[1-9][0-9]*)$/.exec(header);
  if (!match) throw new GitError('Corrupt', 'Malformed Git object header');
  const size = Number(match[2]);
  checkLimit(size, maxObjectBytes, 'Git object size');
  if (raw.length - terminator - 1 !== size) throw new GitError('Corrupt', 'Git object size does not match its header');
  return { type: match[1], data: raw.slice(terminator + 1), size };
}

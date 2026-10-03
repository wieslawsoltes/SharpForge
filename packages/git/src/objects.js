import { GitError, checkLimit } from './errors.js';
import { hashObject } from './hash.js';
import { getObjectFormat, validateObjectId } from './object-format.js';
import { serializeObject, parseObject, MAX_OBJECT_BYTES } from './objects/framing.js';
import { deflateZlib, inflateZlib } from './zlib.js';
import { decodeTree } from './objects/tree.js';
import { decodeCommit, decodeTag } from './objects/commit.js';

export { hashObject } from './hash.js';
export { serializeObject, parseObject, objectHeader, GitObjectType, MAX_OBJECT_BYTES } from './objects/framing.js';
export { encodeTree, decodeTree, compareTreeEntries, GitTreeMode } from './objects/tree.js';
export { encodeCommit, decodeCommit, encodeTag, decodeTag, parseIdentity, formatIdentity } from './objects/commit.js';
export { decodeHeaders, encodeHeaders } from './objects/headers.js';

const validators = Object.freeze({ tree: decodeTree, commit: decodeCommit, tag: decodeTag });

/** Validate type-specific semantics before untrusted objects enter the database. */
export function validateObject(type, data, options = {}) {
  if (type === 'blob') return;
  const validator = validators[type];
  if (!validator) throw new GitError('Corrupt', 'Unknown Git object type', { type });
  validator(data, options);
}

/** Serialize and compress an object with an envelope output bound (64 MiB by default). */
export async function encodeLooseObject(type, data, options = {}) {
  const maximum = options.maxObjectBytes ?? MAX_OBJECT_BYTES;
  validateObject(type, data, options);
  const raw = serializeObject(type, data, options);
  checkLimit(raw.length, maximum, 'Loose object envelope size');
  return deflateZlib(raw, { ...options, maxInputBytes: maximum });
}

/** Decode, validate and verify a loose object; no unverified caller-supplied ID is returned. */
export async function decodeLooseObject(bytes, options = {}) {
  const algorithm = getObjectFormat(options.algorithm).name;
  const maximum = options.maxObjectBytes ?? MAX_OBJECT_BYTES;
  const raw = await inflateZlib(bytes, { ...options, maxOutputBytes: maximum });
  const object = parseObject(raw, options);
  validateObject(object.type, object.data, { ...options, algorithm });
  const oid = await hashObject(object.type, object.data, { ...options, algorithm });
  if (options.oid !== undefined && oid !== validateObjectId(options.oid, algorithm)) {
    throw new GitError('Corrupt', 'Loose object content does not match its object ID', { expected: options.oid, actual: oid });
  }
  return { oid, ...object };
}

import { GitError, checkCancelled } from '../errors.js';

/** Validate a repository-relative storage key before any filesystem access. */
export function validateStorageKey(key, { prefix = false } = {}) {
  if (typeof key !== 'string' || key.includes('\\') || /[\x00-\x1f\x7f]/u.test(key) || key.startsWith('/')) {
    throw new GitError('Unsafe', 'Invalid repository storage path');
  }
  if (key.length > 32768) throw new GitError('Limit', 'Repository storage path is too long');
  const parts = (prefix && key.endsWith('/') ? key.slice(0, -1) : key).split('/');
  if ((!key && !prefix) || parts.some(part => part === '.' || part === '..' || (!part && key))) {
    throw new GitError('Unsafe', 'Repository storage path must be relative and normalized', { key });
  }
  return key;
}

/** Copy bytes so callers cannot mutate committed storage through an alias. */
export function copyBytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('Repository storage values must be Uint8Array');
  return value.slice();
}

export function sameBytes(left, right) {
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

/** Serialize asynchronous transactions without a process-global lock. */
export class StoreMutex {
  #tail = Promise.resolve();

  async run(callback, { signal } = {}) {
    checkCancelled(signal);
    let release;
    const previous = this.#tail;
    this.#tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      checkCancelled(signal);
      return await callback();
    } finally {
      release();
    }
  }
}

export function storageFailure(error, operation) {
  if (error instanceof GitError) return error;
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new GitError('Unsafe', `Repository storage permission denied during ${operation}`);
  }
  return GitError.from(error);
}

export const encodeStorageText = value => new TextEncoder().encode(value);
export function decodeStorageText(value) {
  if (value === undefined) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value); }
  catch { throw new GitError('Corrupt', 'Repository metadata is not valid UTF-8'); }
}

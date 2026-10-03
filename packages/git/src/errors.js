/** Stable wire codes. Consumers must branch on code, never message text. */
export const GitErrorCode = Object.freeze({
  NotFound: 'NotFound', Corrupt: 'Corrupt', Auth: 'Auth', Network: 'Network',
  Conflict: 'Conflict', Unsafe: 'Unsafe', Cancelled: 'Cancelled',
  Unsupported: 'Unsupported', Limit: 'Limit', Quota: 'Quota', Disposed: 'Disposed'
});

/** An explicit operation failure with JSON-safe diagnostic details. */
export class GitError extends Error {
  constructor(code, message, details = {}) {
    if (!Object.hasOwn(GitErrorCode, code)) throw new TypeError(`Unknown Git error code: ${code}`);
    super(String(message));
    this.name = 'GitError';
    this.code = code;
    this.details = Object.freeze(JSON.parse(JSON.stringify(details)));
  }

  toJSON() {
    return Object.freeze({ name: this.name, code: this.code, message: this.message, details: this.details });
  }

  static from(value) {
    if (value instanceof GitError) return value;
    if (value?.name === 'AbortError') return new GitError('Cancelled', 'Git operation cancelled');
    if (value?.name === 'QuotaExceededError') return new GitError('Quota', 'Repository storage quota exceeded');
    return new GitError('Corrupt', value?.message ?? 'Git operation failed');
  }
}

/** Throw before effects if the caller has cancelled the operation. */
export function checkCancelled(signal) {
  if (signal?.aborted) throw new GitError('Cancelled', 'Git operation cancelled');
}

/** Validate a resource bound before allocating memory from an untrusted length. */
export function checkLimit(value, maximum, name = 'Git resource') {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new GitError('Limit', `${name} exceeds its limit`, { value, maximum });
  }
  return value;
}

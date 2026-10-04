import { GitError, checkLimit } from '../errors.js';

export const GIT_PROTOCOL_VERSION = 1;
const maxArtifactBytes = 64 * 1024 * 1024;
const maxEnvelopeBytes = 64 * 1024;
export const GIT_WORKER_LIMITS = Object.freeze({ maxPending: 128, maxArtifactBytes, maxEnvelopeBytes,
  maxMessageBytes: maxArtifactBytes + maxEnvelopeBytes });

function validatePayload(payload) {
  const pending = [payload];
  const seen = new Set();
  let size = 0;
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') size += value.length * 2;
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      checkLimit(seen.size, 100000, 'Git worker payload object count');
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) size += value.byteLength;
      else if (typeof FileSystemHandle !== 'undefined' && value instanceof FileSystemHandle) size += 1024;
      else if (Array.isArray(value)) {
        checkLimit(value.length + pending.length, 100000, 'Git worker array length');
        for (const item of value) pending.push(item);
      }
      else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
        for (const [key, item] of Object.entries(value)) { size += key.length * 2; pending.push(item); }
      } else throw new GitError('Unsafe', 'Unsupported value in Git worker payload');
    } else size += 8;
    checkLimit(size, GIT_WORKER_LIMITS.maxMessageBytes, 'Git worker payload bytes');
    checkLimit(pending.length, 100000, 'Git worker pending payload values');
  }
}

/** Validate routing before invoking any repository operation. */
export function validateGitMessage(message) {
  if (!message || message.version !== GIT_PROTOCOL_VERSION || !['request', 'cancel'].includes(message.type)) {
    throw new GitError('Corrupt', 'Invalid Git worker protocol envelope');
  }
  if (typeof message.session !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(message.session)) {
    throw new GitError('Unsafe', 'Invalid Git worker session');
  }
  checkLimit(message.id, Number.MAX_SAFE_INTEGER, 'Request identity');
  if (!message.id) throw new GitError('Corrupt', 'Request identity must be positive');
  if (message.type === 'request' && (typeof message.method !== 'string' || message.method.length > 80)) {
    throw new GitError('Corrupt', 'Invalid Git worker operation');
  }
  if (message.type === 'request') validatePayload(message.params);
  return message;
}

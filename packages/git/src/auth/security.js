import { GitError, checkCancelled, checkLimit } from '../errors.js';

/** Validate an exact secure origin; credentials, fragments and wildcard grants are rejected. */
export function secureUrl(input, { protocols = ['https:', 'wss:'], allowLoopback = false } = {}) {
  let url;
  try { url = new URL(input); } catch { throw new GitError('Unsafe', 'An absolute secure URL is required'); }
  const loopback = allowLoopback && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!protocols.includes(url.protocol) && !(loopback && ['http:', 'ws:'].includes(url.protocol))) ||
      url.username || url.password || url.hash || url.hostname.includes('*')) {
    throw new GitError('Unsafe', 'URL protocol, embedded credentials or fragment is not permitted');
  }
  return url;
}

/** Convert bytes to RFC 4648 base64 without Node-specific APIs. */
export function encodeBase64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(text);
}

export function decodeBase64(text, maximum = 64 * 1024 * 1024) {
  if (typeof text !== 'string') throw new GitError('Corrupt', 'Expected base64 text');
  checkLimit(text.length, Math.ceil(maximum / 3) * 4 + 8, 'Base64 payload');
  let decoded;
  try { decoded = atob(text.replace(/\s/g, '')); } catch { throw new GitError('Corrupt', 'Invalid base64 payload'); }
  checkLimit(decoded.length, maximum, 'Decoded payload');
  return Uint8Array.from(decoded, value => value.charCodeAt(0));
}

export function base64Url(bytes) {
  return encodeBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function requireCrypto(crypto = globalThis.crypto) {
  if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') {
    throw new GitError('Unsupported', 'A secure WebCrypto context is required');
  }
  return crypto;
}

export function tokenText(value, name = 'Access token') {
  if (typeof value !== 'string' || !value.length || value.length > 16384 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new GitError('Auth', `${name} is empty, too long or contains control characters`);
  }
  return value;
}

/** Cancellable timer used only at effect boundaries; clock and timer can be injected. */
export function abortableDelay(milliseconds, signal) {
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new GitError('Cancelled', 'Git operation cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Drain a network response with a byte limit, before JSON parsing or buffering untrusted data. */
export async function responseBytes(response, maximum = 4 * 1024 * 1024, signal) {
  const announced = response.headers.get('content-length');
  if (announced !== null && Number(announced) > maximum) {
    await response.body?.cancel();
    throw new GitError('Limit', 'Provider response exceeds its byte limit', { maximum });
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      checkCancelled(signal);
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      checkLimit(length, maximum, 'Provider response');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

import {delay} from './settings.js';

/** Decode authorized metadata in bounded chunks, yielding between chunks to keep the editor responsive. */
export async function decodeNativeMetadata(response, contextId, {signal, maxBytes = 32 * 1024 * 1024} = {}) {
  if (response?.contextId !== contextId) throw new Error('Native reference metadata belongs to a different project context');
  if (!Array.isArray(response.references) || response.references.length > 512) throw new Error('Native reference count limit exceeded');
  const references = [];
  const identities = new Set();
  let totalBytes = 0;
  for (const reference of response.references) {
    signal?.throwIfAborted();
    if (typeof reference.path !== 'string' || identities.has(reference.path)) throw new Error('Invalid native reference identity');
    identities.add(reference.path);
    const base64 = reference.base64;
    if (!Number.isSafeInteger(reference.size) || reference.size < 0 || reference.size > 8 * 1024 * 1024 ||
        (totalBytes += reference.size) > maxBytes) throw new Error('Native reference byte limit exceeded');
    if (typeof base64 !== 'string' || base64.length !== Math.ceil(reference.size / 3) * 4) {
      throw new Error('Invalid native reference encoding');
    }
    const bytes = new Uint8Array(reference.size);
    let offset = 0;
    for (let start = 0; start < base64.length; start += 131072) {
      signal?.throwIfAborted();
      const chunk = base64.slice(start, start + 131072);
      const final = start + 131072 >= base64.length;
      if (!(final ? /^[A-Za-z0-9+/]*={0,2}$/ : /^[A-Za-z0-9+/]+$/).test(chunk)) throw new Error('Invalid native reference encoding');
      const decoded = atob(chunk);
      if (offset + decoded.length > bytes.length) throw new Error('Native reference size mismatch');
      for (let index = 0; index < decoded.length; index++) bytes[offset++] = decoded.charCodeAt(index);
      if (start + 131072 < base64.length) await delay(0, signal);
    }
    if (offset !== reference.size) throw new Error('Native reference size mismatch');
    if (reference.sha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/i.test(reference.sha256)) throw new Error('Invalid native reference hash');
      if (!globalThis.crypto?.subtle) throw new Error('A secure browser context is required to verify native metadata');
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const actual = [...hash].map(value => value.toString(16).padStart(2, '0')).join('');
      if (actual !== reference.sha256.toLowerCase()) throw new Error('Native reference hash mismatch: ' + reference.path);
    }
    references.push({bytes, display: reference.display ?? reference.path, aliases: reference.aliases ?? ['global']});
  }
  if (response.totalBytes !== undefined && response.totalBytes !== totalBytes) throw new Error('Native reference aggregate size mismatch');
  return references;
}

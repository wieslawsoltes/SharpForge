import { fail } from './contracts.js';

function decoder(encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true });
  } catch {
    fail('Unsupported source encoding: ' + encoding);
  }
}

function sourceBom(bytes) {
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 255 && bytes[1] === 254 && bytes[2] === 0 && bytes[3] === 0) ||
      (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 254 && bytes[3] === 255))
  ) {
    fail('Unsupported UTF-32 source encoding');
  }
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return ['utf-8', 3];
  if (bytes[0] === 255 && bytes[1] === 254) return ['utf-16le', 2];
  if (bytes[0] === 254 && bytes[1] === 255) return ['utf-16be', 2];
  return ['utf-8', 0];
}

/** Decode raw source bytes after checksum verification; preserves line endings and never normalizes bytes. */
export function decodeSource(bytes, { fallbackEncoding = null, maxBytes = 16 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail('Invalid source byte limit');
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes) fail('Invalid or oversized source bytes');
  if (fallbackEncoding !== null && typeof fallbackEncoding !== 'string') fail('Invalid fallback source encoding');
  const fallback = fallbackEncoding === null ? null : decoder(fallbackEncoding);
  const [encoding, bomBytes] = sourceBom(bytes);
  const primary = decoder(encoding);
  try {
    return { text: primary.decode(bytes), encoding: primary.encoding, bomBytes };
  } catch {
    if (bomBytes || !fallback) fail('Invalid ' + encoding + ' source bytes');
  }
  try {
    return { text: fallback.decode(bytes), encoding: fallback.encoding, bomBytes: 0 };
  } catch {
    fail('Invalid ' + fallback.encoding + ' source bytes');
  }
}

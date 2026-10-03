import { utf8, equalBytes } from '@sharpforge/cil';
import { sha256, sha1 } from './hash.js';
import { PdbGuids, fail } from './contracts.js';
import { projectSources } from './source-projection.js';
import { decodeSource } from './source-encoding.js';
export function verifySource(document, input) {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  if (!(bytes instanceof Uint8Array)) fail('Source must be text or bytes');
  if (document.hashAlgorithm === PdbGuids.sha256) return equalBytes(sha256(bytes), document.hash);
  if (document.hashAlgorithm === PdbGuids.sha1) return equalBytes(sha1(bytes), document.hash);
  return false;
}
export async function verifySourceAsync(document, input) {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  if (!(bytes instanceof Uint8Array)) fail('Source must be text or bytes');
  const algorithm = {
    [PdbGuids.sha1]: 'SHA-1',
    [PdbGuids.sha256]: 'SHA-256',
    [PdbGuids.sha384]: 'SHA-384',
    [PdbGuids.sha512]: 'SHA-512',
  }[document.hashAlgorithm];
  if (!algorithm) return false;
  if (!globalThis.crypto?.subtle) return verifySource(document, bytes);
  return equalBytes(new Uint8Array(await crypto.subtle.digest(algorithm, bytes)), document.hash);
}
export { sourceLinkUrl } from './source-link.js';
/** Attach only checksum-verified source; never fetch Source Link implicitly. */
export function bindSources(symbols, sources = {}, options = {}) {
  const byName = sources instanceof Map ? sources : new Map(Object.entries(sources)),
    documents = symbols.documents.map((d) => {
      const raw = byName.get(d.name) ?? d.embedded,
        bytes = typeof raw === 'string' ? utf8(raw) : raw,
        verified = bytes ? verifySource(d, bytes) : false;
      const decoded = verified ? decodeSource(bytes, options) : null;
      return {
        ...d,
        verified,
        text: decoded?.text ?? null,
        encoding: decoded?.encoding ?? null,
        reason:
          raw === undefined
            ? 'Source not supplied'
            : verified
              ? 'Checksum verified'
              : 'Source checksum mismatch or unsupported algorithm',
      };
    });
  return projectSources(symbols, documents, { includeUnverifiedPoints: true });
}

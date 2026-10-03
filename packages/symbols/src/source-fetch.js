import { PdbGuids } from './contracts.js';
import { verifySourceAsync } from './source-binding.js';
import { decodeSource } from './source-encoding.js';
import { createPermissionedFetcher } from './permission-fetch.js';
import { SourceStatus, sourceFailure, sourceResult } from './source-status.js';

const hashSizes = new Map([
  [PdbGuids.sha1, 20],
  [PdbGuids.sha256, 32],
  [PdbGuids.sha384, 48],
  [PdbGuids.sha512, 64],
]);

/** Create an opt-in, origin-granted source client. No I/O occurs until fetch(document, url) is called. */
export function createSourceFetcher(options = {}) {
  const transport = createPermissionedFetcher(options);
  const decoding = {
    fallbackEncoding: options.fallbackEncoding ?? null,
    maxBytes: options.maxBytes ?? 16 * 1024 * 1024,
  };
  decodeSource(new Uint8Array(), decoding);
  return {
    async fetch(document, url, { signal } = {}) {
      const size = hashSizes.get(document?.hashAlgorithm);
      if (!size || !(document.hash instanceof Uint8Array) || document.hash.length !== size) {
        return sourceResult(SourceStatus.unsupportedHash, {
          reason: 'Source checksum algorithm or hash is unsupported',
        });
      }
      if (size >= 48 && !globalThis.crypto?.subtle) {
        return sourceResult(SourceStatus.unsupportedHash, { reason: 'SHA-384/512 verification requires WebCrypto' });
      }
      const expected = { hashAlgorithm: document.hashAlgorithm, hash: new Uint8Array(document.hash) };
      return transport.read(url, {
        signal,
        purpose: 'source-link',
        async validate(bytes) {
          if (!(await verifySourceAsync(expected, bytes))) {
            throw sourceFailure(SourceStatus.mismatch, 'Source checksum mismatch');
          }
          try {
            return { ...decodeSource(bytes, decoding), provenance: 'source-link' };
          } catch (error) {
            throw sourceFailure(SourceStatus.invalidEncoding, error.message);
          }
        },
      });
    },
    dispose() {
      transport.dispose();
    },
    get cleanupErrors() {
      return transport.cleanupErrors;
    },
  };
}

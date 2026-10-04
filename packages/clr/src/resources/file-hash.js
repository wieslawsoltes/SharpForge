import { sha1, sha256 } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';
import { invalidManifest, sameBytes } from './manifest-options.js';
import { fileMd5 } from './file-md5.js';

const algorithms = Object.freeze({
  0: Object.freeze({ name: 'SHA-1', size: 20, digest: sha1 }),
  0x8003: Object.freeze({ name: 'MD5', size: 16, digest: fileMd5 }),
  0x8004: Object.freeze({ name: 'SHA-1', size: 20, digest: sha1 }),
  0x800c: Object.freeze({ name: 'SHA-256', size: 32, digest: sha256 }),
  0x800d: Object.freeze({ name: 'SHA-384', size: 48 }),
  0x800e: Object.freeze({ name: 'SHA-512', size: 64 }),
});

export function fileHashAlgorithm(id, expected) {
  const algorithm = algorithms[id];
  if (!algorithm) throw invalidManifest(`Invalid assembly file hash algorithm ${id}`);
  if (expected.length !== algorithm.size) throw invalidManifest(`Invalid ${algorithm.name} file hash length`);
  return algorithm;
}

/** Verify the complete external file before interpreting it. None follows the CLI SHA-1 default for multi-file assemblies. */
export async function verifyManifestFile(file, bytes, signal) {
  checkCancellation(signal);
  const algorithm = fileHashAlgorithm(file.hashAlgorithm, file.hashValue);
  const subtle = globalThis.crypto?.subtle;
  if (!algorithm.digest && typeof subtle?.digest !== 'function') {
    throw loadError(LoadErrorCode.UnsupportedFeature, `${algorithm.name} file verification requires host Web Crypto`);
  }
  let actual;
  try {
    actual = algorithm.digest ? algorithm.digest(bytes) : new Uint8Array(await subtle.digest(algorithm.name, bytes));
  } catch (error) {
    checkCancellation(signal);
    const code = error?.name === 'NotSupportedError' ? LoadErrorCode.UnsupportedFeature : LoadErrorCode.FileLoad;
    throw loadError(code, `${algorithm.name} manifest file verification failed: ${error?.message ?? String(error)}`,
      { requester: file.assembly.fullName });
  }
  checkCancellation(signal);
  if (!sameBytes(actual, file.hashValue)) {
    throw loadError(LoadErrorCode.FileLoad, `Manifest file hash mismatch for ${file.name}`,
      { requester: file.assembly.fullName });
  }
}

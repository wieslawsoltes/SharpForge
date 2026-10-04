import { loadError, LoadErrorCode } from '../load-errors.js';

const defaults = Object.freeze({
  maxResources: 65535, maxNameBytes: 16384, maxMetadataCharacters: 16 * 1024 * 1024,
  maxSources: 128, maxFiles: 1024, maxPendingFiles: 32, maxHops: 128,
  maxResourceBytes: 64 * 1024 * 1024, maxDirectoryBytes: 64 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024, maxCachedFileBytes: 128 * 1024 * 1024,
});
const ceilings = Object.freeze({
  maxResources: 65535, maxNameBytes: 1024 * 1024, maxMetadataCharacters: 64 * 1024 * 1024,
  maxSources: 4096, maxFiles: 65535, maxPendingFiles: 1024, maxHops: 1024,
  maxResourceBytes: 256 * 1024 * 1024, maxDirectoryBytes: 256 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024, maxCachedFileBytes: 256 * 1024 * 1024,
});
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;

export const invalidManifest = message => loadError(LoadErrorCode.InvalidImage, message);
export const manifestLimit = message => loadError(LoadErrorCode.LimitExceeded, message);

export function manifestOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw loadError(LoadErrorCode.InvalidConfiguration, 'Manifest resource options must be an object');
  }
  const result = { fileProvider: options.fileProvider ?? null };
  if (result.fileProvider !== null && typeof result.fileProvider !== 'function') {
    throw loadError(LoadErrorCode.InvalidConfiguration, 'Manifest file provider must be callable');
  }
  for (const name of Object.keys(defaults)) {
    const value = options[name] ?? defaults[name];
    if (!Number.isSafeInteger(value) || value < 0 || value > ceilings[name] || (name === 'maxSources' && value === 0)) {
      throw loadError(LoadErrorCode.InvalidConfiguration, `Invalid manifest resource limit ${name}`);
    }
    result[name] = value;
  }
  return Object.freeze(result);
}

/** Inspect the actual intrinsic length before allocating; subclass properties cannot bypass byte budgets. */
export function manifestFileBytes(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array)) throw invalidManifest('Manifest file provider must return bytes or null');
  return { bytes, length: typedArrayByteLength.call(bytes) };
}

export function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

/** Count lookup UTF-8 bytes without allocating another copy of a potentially large caller-supplied name. */
export function requireManifestNameBudget(name, maximum) {
  let bytes = 0;
  for (let index = 0; index < name.length; index++) {
    const character = name.charCodeAt(index);
    bytes += character < 0x80 ? 1 : character < 0x800 ? 2 : 3;
    if (character >= 0xd800 && character <= 0xdbff && index + 1 < name.length) {
      const next = name.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes++;
        index++;
      }
    }
    if (bytes > maximum) throw manifestLimit('Manifest resource lookup name byte limit exceeded');
  }
}

export function manifestOperation(operation) {
  try { return operation(); }
  catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('SFCLR')) throw error;
    throw invalidManifest(`Invalid manifest resource: ${error?.message ?? String(error)}`);
  }
}

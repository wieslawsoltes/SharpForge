import { GitError } from './errors.js';

const formats = Object.freeze({
  sha1: Object.freeze({
    name: 'sha1', algorithm: 'sha1', oidBytes: 20, oidLength: 40,
    rawLength: 20, hexLength: 40, zeroOid: '0'.repeat(40), cryptoName: 'SHA-1'
  }),
  sha256: Object.freeze({
    name: 'sha256', algorithm: 'sha256', oidBytes: 32, oidLength: 64,
    rawLength: 32, hexLength: 64, zeroOid: '0'.repeat(64), cryptoName: 'SHA-256'
  })
});

/** Resolve an explicit Git object format; unknown algorithms are never downgraded. */
export function getObjectFormat(algorithm = 'sha1') {
  const name = typeof algorithm === 'string' ? algorithm : algorithm?.name ?? algorithm?.algorithm;
  if (!Object.hasOwn(formats, name ?? '')) {
    throw new GitError('Unsupported', 'Unsupported Git object format', { algorithm: name ?? null });
  }
  return formats[name];
}

/** Convert binary object IDs or checksums to lowercase hexadecimal without coercion. */
export function bytesToHex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  const characters = new Array(bytes.length * 2);
  const digits = '0123456789abcdef';
  for (let index = 0; index < bytes.length; index++) {
    characters[index * 2] = digits[bytes[index] >>> 4];
    characters[index * 2 + 1] = digits[bytes[index] & 15];
  }
  return characters.join('');
}

/** Decode complete hexadecimal bytes; odd, empty or malformed values are Corrupt. */
export function hexToBytes(hex) {
  if (typeof hex !== 'string' || !hex.length || hex.length % 2 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new GitError('Corrupt', 'Invalid hexadecimal byte sequence');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** Validate a full object ID for one format and return its canonical spelling. */
export function validateObjectId(oid, algorithm = 'sha1', { allowZero = true } = {}) {
  const format = getObjectFormat(algorithm);
  if (typeof oid !== 'string' || oid.length !== format.oidLength || !/^[0-9a-fA-F]+$/.test(oid)) {
    throw new GitError('Corrupt', 'Invalid Git object ID', { algorithm: format.name });
  }
  const normalized = oid.toLowerCase();
  if (!allowZero && normalized === format.zeroOid) throw new GitError('Corrupt', 'A stored object ID cannot be zero');
  return normalized;
}

function configValue(config, section, name) {
  if (typeof config?.get === 'function') return config.get(`${section}.${name}`);
  return config?.[`${section}.${name}`] ?? config?.[section]?.[name];
}

/** Read repository configuration, requiring format version 1 for extensions.objectFormat. */
export function detectObjectFormat(config = {}) {
  const name = configValue(config, 'extensions', 'objectFormat') ?? configValue(config, 'extensions', 'objectformat');
  const rawVersion = configValue(config, 'core', 'repositoryFormatVersion')
    ?? configValue(config, 'core', 'repositoryformatversion') ?? 0;
  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version < 0 || version > 1) {
    throw new GitError('Unsupported', 'Unsupported Git repository format version', { version: rawVersion });
  }
  if (name !== undefined && version !== 1) throw new GitError('Corrupt', 'Object-format extension requires repository version 1');
  return getObjectFormat(name ?? 'sha1');
}

/** Decode the protocol capability; absence means SHA-1 according to the Git wire protocol. */
export function advertisedObjectFormat(capabilities = []) {
  const values = capabilities instanceof Map ? [...capabilities].map(([key, value]) => `${key}=${value}`) : capabilities;
  const list = typeof values === 'string' ? values.split(/\s+/) : [...values];
  const names = list.filter(value => value.startsWith('object-format=')).map(value => value.slice(14));
  if (names.length > 1) throw new GitError('Corrupt', 'Duplicate object-format capability');
  return getObjectFormat(names[0] ?? 'sha1');
}

/** Reject cross-format transfer before IDs, refs, deltas or checksums can be misinterpreted. */
export function assertCompatibleObjectFormat(local, remote) {
  const localFormat = getObjectFormat(local);
  const remoteFormat = getObjectFormat(remote);
  if (localFormat.name !== remoteFormat.name) {
    throw new GitError('Unsupported', 'Git object formats differ; object translation is required', {
      local: localFormat.name, remote: remoteFormat.name
    });
  }
  return localFormat;
}

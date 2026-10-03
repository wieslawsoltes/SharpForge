import { AssemblyName } from './assembly-name.js';
import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';

const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const equalText = (left, right) => left.toLowerCase() === right.toLowerCase();

/** Derive a strong-name token with host Web Crypto (SHA-1, reversed final eight bytes). No I/O. */
export async function computePublicKeyToken(publicKey, { signal } = {}) {
  checkCancellation(signal);
  if (!(publicKey instanceof Uint8Array)) throw loadError(LoadErrorCode.InvalidImage, 'Public key must be bytes');
  if (publicKey.length > 65536) throw loadError(LoadErrorCode.LimitExceeded, 'Public key exceeds 65536 bytes');
  if (!publicKey.length) return '';
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', publicKey));
  checkCancellation(signal);
  return hex(digest.subarray(digest.length - 8).reverse());
}

/** Resolve a parsed full public key to an immutable token-bearing identity. */
export async function normalizeAssemblyIdentity(value, options) {
  const identity = typeof value === 'string' ? AssemblyName.parse(value) : new AssemblyName(value);
  if (identity.publicKey === null) return identity;
  const key = Uint8Array.from(identity.publicKey.match(/../g) ?? [], pair => parseInt(pair, 16));
  const publicKeyToken = await computePublicKeyToken(key, options);
  return new AssemblyName({ ...identity, publicKeyToken });
}

/** Convert decoded ECMA II.22.2/II.22.5 rows using explicit heap readers. */
export async function assemblyIdentityFromRow(row, { readString, readBlob, reference = false, signal } = {}) {
  if (!row || typeof readString !== 'function' || typeof readBlob !== 'function') {
    throw loadError(LoadErrorCode.InvalidImage, 'Assembly row and heap readers are required');
  }
  checkCancellation(signal);
  try {
    const flags = row.Flags ?? row.flags ?? 0;
    const key = readBlob(reference ? row.PublicKeyOrToken : row.PublicKey);
    if (!(key instanceof Uint8Array) || (reference && !(flags & 1) && key.length !== 0 && key.length !== 8)) {
      throw loadError(LoadErrorCode.InvalidImage, 'Malformed assembly key blob');
    }
    const publicKeyToken = !reference || (flags & 1) ? await computePublicKeyToken(key, { signal }) : hex(key);
    return new AssemblyName({
      name: readString(row.Name), culture: readString(row.Culture), publicKeyToken,
      version: [row.MajorVersion, row.MinorVersion, row.BuildNumber, row.RevisionNumber],
      retargetable: Boolean(flags & 0x100), contentType: (flags & 0xe00) === 0x200 ? 'WindowsRuntime' : 'Default',
    });
  } catch (error) {
    if (error.code === LoadErrorCode.Cancelled || error.code === LoadErrorCode.LimitExceeded) throw error;
    throw loadError(LoadErrorCode.InvalidImage, `Invalid assembly metadata: ${error.message}`);
  }
}

/** Lexicographic version ordering, with omitted components treated as zero for binding. */
export function compareAssemblyVersions(left, right) {
  for (let index = 0; index < 4; index++) {
    const difference = (left?.[index] ?? 0) - (right?.[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/** Return all mismatches; only explicitly omitted reference fields are unconstrained. */
export function compareAssemblyIdentity(reference, definition, { versionPolicy = 'exact', rollForward = 'minor' } = {}) {
  if (!['exact', 'higher', 'roll-forward'].includes(versionPolicy)) throw new TypeError('Unknown version policy');
  if (!['patch', 'minor', 'major'].includes(rollForward)) throw new TypeError('Unknown roll-forward policy');
  const requested = typeof reference === 'string' ? AssemblyName.parse(reference) : new AssemblyName(reference);
  const candidate = typeof definition === 'string' ? AssemblyName.parse(definition) : new AssemblyName(definition);
  if (requested.publicKey !== null && requested.publicKeyToken === null) {
    throw loadError(LoadErrorCode.InvalidName, 'Normalize full public keys before comparison');
  }
  const mismatches = [];
  if (!equalText(requested.name, candidate.name)) mismatches.push('name');
  if (requested.culture !== null && !equalText(requested.culture, candidate.culture ?? '')) mismatches.push('culture');
  if (requested.publicKeyToken !== null && requested.publicKeyToken !== (candidate.publicKeyToken ?? '')) mismatches.push('token');
  if (requested.contentType !== candidate.contentType) mismatches.push('contentType');
  if (requested.version !== null) {
    const order = compareAssemblyVersions(candidate.version, requested.version);
    const crossedMajor = candidate.version?.[0] !== requested.version[0];
    const crossedMinor = candidate.version?.[1] !== requested.version[1];
    const invalidRoll = versionPolicy === 'roll-forward' &&
      ((rollForward !== 'major' && crossedMajor) || (rollForward === 'patch' && crossedMinor));
    if (versionPolicy === 'exact' ? order !== 0 : order < 0 || invalidRoll) mismatches.push('version');
  }
  return Object.freeze({ matches: mismatches.length === 0, mismatches: Object.freeze(mismatches) });
}

/**
 * Assembly identities (ECMA-335 II.22.2 / II.22.5) with Roslyn's display, parsing and comparison rules.
 * Identity consists of name, version, culture, public key/token, retargetability and content type.
 */
import { displayNamePieces } from './assembly-display-name.js';

const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16));
const rotateLeft = (value, count) => (value << count) | (value >>> (32 - count));
const sameText = (left, right) => left.toLowerCase() === right.toLowerCase();

/** SHA-1 bytes. Public key tokens use the last eight bytes of this digest in reverse order. */
export function sha1(bytes) {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >>> 6) + 1) * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Int32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      words[i] = rotateLeft(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const mixed = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const constant = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const next = (rotateLeft(a, 5) + mixed + e + constant + words[i]) | 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = next;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const output = new Uint8Array(20);
  const outputView = new DataView(output.buffer);
  [h0, h1, h2, h3, h4].forEach((word, index) => outputView.setInt32(index * 4, word));
  return output;
}

/** The eight-byte public key token as lowercase hex, or an empty string for an empty key. */
export function publicKeyToken(publicKey) {
  return publicKey.length ? hex(sha1(publicKey).slice(12).reverse()) : '';
}

/** Which parts a parsed display name specified, matching Roslyn AssemblyIdentityParts. */
export const AssemblyIdentityParts = Object.freeze({
  Name: 1, Version: 2, Culture: 4, PublicKeyOrToken: 8, Retargetability: 16, ContentType: 32,
});

export const IdentityComparison = Object.freeze({
  NotEquivalent: 'notEquivalent', Equivalent: 'equivalent', EquivalentIgnoringVersion: 'equivalentIgnoringVersion',
});

function versionOf(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '0.0.0.0').split('.').map(Number);
  if (parts.length > 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 65535)) {
    throw new RangeError(`Invalid assembly version '${value}'`);
  }
  return Object.freeze([parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0]);
}

/** Return -1, 0 or 1 for two four-part version arrays. */
export function compareVersions(left, right) {
  for (let i = 0; i < 4; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

function parseVersion(init, value) {
  const numbers = value.split('.');
  if (numbers.length > 4 || numbers.some(number => !/^\d{1,5}$/.test(number) || Number(number) > 65535)) return null;
  init.version = numbers.map(Number);
  return numbers.length === 4 ? AssemblyIdentityParts.Version : 0;
}

function parseCulture(init, value) {
  init.cultureName = value;
  return AssemblyIdentityParts.Culture;
}

const displayPropertyParsers = {
  version: parseVersion,
  culture: parseCulture,
  language: parseCulture,
  publickeytoken(init, value) {
    if (!sameText(value, 'null') && !/^[0-9a-f]{16}$/i.test(value)) return null;
    init.publicKeyToken = sameText(value, 'null') ? '' : value;
    return AssemblyIdentityParts.PublicKeyOrToken;
  },
  publickey(init, value) {
    if (!sameText(value, 'null') && !/^([0-9a-f]{2})+$/i.test(value)) return null;
    init.publicKey = sameText(value, 'null') ? '' : value;
    return AssemblyIdentityParts.PublicKeyOrToken;
  },
  retargetable(init, value) {
    if (!sameText(value, 'yes') && !sameText(value, 'no')) return null;
    init.isRetargetable = sameText(value, 'yes');
    return AssemblyIdentityParts.Retargetability;
  },
  contenttype(init, value) {
    if (!sameText(value, 'windowsruntime')) return null;
    init.contentType = 'windowsRuntime';
    return AssemblyIdentityParts.ContentType;
  },
};

/** Immutable assembly identity. Invalid simple names or version components throw RangeError. */
export class AssemblyIdentity {
  /**
   * Accept name, version (array or dotted text), cultureName, publicKey/publicKeyToken (hex or bytes),
   * isRetargetable and contentType ('default' or 'windowsRuntime'). Empty tokens remain empty strings.
   */
  constructor(init = {}) {
    if (!init.name) throw new RangeError('An assembly identity needs a simple name');
    const text = value => value == null ? '' : typeof value === 'string' ? value.toLowerCase() : hex(value);
    this.name = init.name;
    this.version = versionOf(init.version);
    this.cultureName = init.cultureName && !sameText(init.cultureName, 'neutral') ? init.cultureName : '';
    this.publicKey = text(init.publicKey);
    this.publicKeyToken = this.publicKey ? publicKeyToken(unhex(this.publicKey)) : text(init.publicKeyToken);
    this.isRetargetable = !!init.isRetargetable;
    this.contentType = init.contentType ?? 'default';
    Object.freeze(this);
  }

  get hasPublicKey() { return this.publicKey !== ''; }
  get isStrongName() { return this.publicKeyToken !== ''; }
  get versionText() { return this.version.join('.'); }

  /** Full identity equality, with case-insensitive simple names and cultures. */
  equals(other) {
    return other instanceof AssemblyIdentity && sameText(this.name, other.name)
      && compareVersions(this.version, other.version) === 0 && sameText(this.cultureName, other.cultureName)
      && this.publicKeyToken === other.publicKeyToken && this.isRetargetable === other.isRetargetable
      && this.contentType === other.contentType;
  }

  /** Full display identity. When requested and available, fullKey writes PublicKey instead of PublicKeyToken. */
  getDisplayName(fullKey = false) {
    const escaped = this.name.replace(/[\\,="']/g, character => '\\' + character);
    return escaped + ', Version=' + this.versionText + ', Culture=' + (this.cultureName || 'neutral')
      + (fullKey && this.hasPublicKey ? ', PublicKey=' + this.publicKey : ', PublicKeyToken=' + (this.publicKeyToken || 'null'))
      + (this.isRetargetable ? ', Retargetable=Yes' : '')
      + (this.contentType === 'windowsRuntime' ? ', ContentType=WindowsRuntime' : '');
  }

  toString() { return this.getDisplayName(); }

  /** Copy this identity with another version, leaving all other identity components unchanged. */
  withVersion(version) {
    return new AssemblyIdentity({ name: this.name, version, cultureName: this.cultureName, publicKey: this.publicKey,
      publicKeyToken: this.publicKeyToken, isRetargetable: this.isRetargetable, contentType: this.contentType });
  }

  /**
   * Return {identity, parts}, or null for an invalid display name. A partial version such as 1.2 is accepted,
   * with zero-filled trailing components, but leaves Version out of the parts bitmask.
   */
  static tryParse(displayName) {
    if (typeof displayName !== 'string') return null;
    const pieces = displayNamePieces(displayName);
    if (!pieces) return null;
    const name = pieces.shift().trim();
    if (!name || name.includes('=')) return null;
    const init = { name };
    let parts = AssemblyIdentityParts.Name;
    const seen = new Set();
    for (const piece of pieces) {
      const equals = piece.indexOf('=');
      if (equals < 0) return null;
      const key = piece.slice(0, equals).trim().toLowerCase();
      const value = piece.slice(equals + 1).trim();
      if (!value || seen.has(key)) return null;
      seen.add(key);
      // Unknown properties (processorArchitecture, custom) are ignored, matching Roslyn.
      const parser = Object.hasOwn(displayPropertyParsers, key) ? displayPropertyParsers[key] : null;
      if (!parser) continue;
      const parsed = parser(init, value);
      if (parsed === null) return null;
      parts |= parsed;
    }
    const fullRetargetable = parts & AssemblyIdentityParts.PublicKeyOrToken
      && parts & AssemblyIdentityParts.Version && parts & AssemblyIdentityParts.Culture;
    if (init.isRetargetable && !fullRetargetable) return null;
    return { identity: new AssemblyIdentity(init), parts };
  }

  /** Parse a display name or throw RangeError. */
  static parse(displayName) {
    const result = AssemblyIdentity.tryParse(displayName);
    if (!result) throw new RangeError(`Invalid assembly display name '${displayName}'`);
    return result.identity;
  }
}

const fullParts = AssemblyIdentityParts.Name | AssemblyIdentityParts.Version
  | AssemblyIdentityParts.Culture | AssemblyIdentityParts.PublicKeyOrToken;

/**
 * Compare a reference identity (or partial display name) with a definition using Roslyn binding rules.
 * Weak definitions match on name and culture. Strong definitions additionally require key and version.
 * options.ignoreVersion reports EquivalentIgnoringVersion for strong version mismatches;
 * options.isFrameworkAssembly(identity) supplies an explicit framework unification policy.
 * Return {result: IdentityComparison value, unificationApplied: boolean}.
 */
export function compareAssemblyIdentity(reference, definition, options = {}) {
  const no = { result: IdentityComparison.NotEquivalent, unificationApplied: false };
  const yes = { result: IdentityComparison.Equivalent, unificationApplied: false };
  let parts = fullParts;
  const text = typeof reference === 'string' ? reference : null;
  if (typeof reference === 'string') {
    const parsed = AssemblyIdentity.tryParse(reference);
    if (!parsed) return no;
    reference = parsed.identity;
    parts = parsed.parts;
  }
  if (parts === fullParts && !reference.isRetargetable && reference.equals(definition)) return yes;
  if (reference.contentType !== definition.contentType) return no;
  if (!sameText(reference.name, definition.name)) return no;
  const compareCulture = !!(parts & AssemblyIdentityParts.Culture);
  const compareKey = !!(parts & AssemblyIdentityParts.PublicKeyOrToken);
  if (compareCulture && !sameText(reference.cultureName, definition.cultureName)) return no;
  // A retargetable reference binds to the platform definition regardless of key and version.
  if (reference.isRetargetable && !definition.isRetargetable) {
    return { result: IdentityComparison.Equivalent,
      unificationApplied: compareVersions(reference.version, definition.version) !== 0
        || reference.publicKeyToken !== definition.publicKeyToken };
  }
  if (!definition.isStrongName) return compareKey && reference.isStrongName ? no : yes;
  if (compareKey && reference.publicKeyToken !== definition.publicKeyToken) return no;
  const hasVersion = !!(parts & AssemblyIdentityParts.Version);
  const specifiedVersion = text === null || /version\s*=/i.test(text);
  if (specifiedVersion && (!hasVersion || compareVersions(reference.version, definition.version) !== 0)) {
    if (hasVersion && options.isFrameworkAssembly?.(definition)) {
      return { result: IdentityComparison.Equivalent, unificationApplied: true };
    }
    return hasVersion && options.ignoreVersion
      ? { result: IdentityComparison.EquivalentIgnoringVersion, unificationApplied: false } : no;
  }
  return yes;
}

/** True when the reference binds to the definition without allowing a strong-name version mismatch. */
export const referenceMatchesDefinition = (reference, definition, options) =>
  compareAssemblyIdentity(reference, definition, options).result === IdentityComparison.Equivalent;

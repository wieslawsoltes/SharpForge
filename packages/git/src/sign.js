import { GitError, checkLimit } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function integer(value) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value);
  return result;
}

function field(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return concat([integer(bytes.length), bytes]);
}

function base64(bytes) {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
}

function unbase64(value) {
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { throw new GitError('Corrupt', 'Invalid SSH signature base64'); }
}

function reader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  return {
    integer() {
      if (offset + 4 > bytes.length) throw new GitError('Corrupt', 'Truncated SSH signature integer');
      const value = view.getUint32(offset);
      offset += 4;
      return value;
    },
    field() {
      const length = this.integer();
      if (length > bytes.length - offset) throw new GitError('Corrupt', 'Truncated SSH signature field');
      const value = bytes.slice(offset, offset + length);
      offset += length;
      return value;
    },
    done() {
      if (offset !== bytes.length) throw new GitError('Corrupt', 'Trailing SSH signature bytes');
    }
  };
}

async function payload(data, { namespace = 'git', reserved = '', hashAlgorithm = 'sha512' } = {}) {
  if (!['sha256', 'sha512'].includes(hashAlgorithm)) throw new GitError('Unsupported', 'Unsupported SSH signature hash');
  const hash = new Uint8Array(await crypto.subtle.digest(hashAlgorithm === 'sha512' ? 'SHA-512' : 'SHA-256', data));
  return concat([encoder.encode('SSHSIG'), field(namespace), field(reserved), field(hashAlgorithm), field(hash)]);
}

/** Create the OpenSSH SSHSIG container Git verifies with an allowed_signers file. */
export async function signSsh(data, { privateKey, publicKey, namespace = 'git', hashAlgorithm = 'sha512' } = {}) {
  if (!privateKey || !publicKey) throw new GitError('Unsupported', 'SSH signing requires an explicit Ed25519 key pair');
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  if (rawKey.length !== 32) throw new GitError('Unsupported', 'SSH signing supports Ed25519 keys');
  const keyBlob = concat([field('ssh-ed25519'), field(rawKey)]);
  const signed = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, await payload(data, { namespace, hashAlgorithm })));
  const signatureBlob = concat([field('ssh-ed25519'), field(signed)]);
  const container = concat([encoder.encode('SSHSIG'), integer(1), field(keyBlob), field(namespace), field(''),
    field(hashAlgorithm), field(signatureBlob)]);
  return `-----BEGIN SSH SIGNATURE-----\n${base64(container).match(/.{1,70}/gu).join('\n')}\n-----END SSH SIGNATURE-----\n`;
}

/** Verify Ed25519 SSHSIG cryptography and optionally enforce an explicit trusted public-key set. */
export async function verifySsh(data, signature, { namespace = 'git', allowedKeys } = {}) {
  checkLimit(signature.length, 1024 * 1024, 'SSH signature size');
  const match = /^-----BEGIN SSH SIGNATURE-----\s+([A-Za-z0-9+/=\s]+)-----END SSH SIGNATURE-----\s*$/u.exec(signature);
  if (!match) throw new GitError('Corrupt', 'Invalid armored SSH signature');
  const bytes = unbase64(match[1].replace(/\s/gu, ''));
  if (decoder.decode(bytes.subarray(0, 6)) !== 'SSHSIG') throw new GitError('Corrupt', 'Invalid SSH signature magic');
  const stream = reader(bytes.subarray(6));
  if (stream.integer() !== 1) throw new GitError('Unsupported', 'Unsupported SSH signature version');
  const publicBlob = stream.field();
  const actualNamespace = decoder.decode(stream.field());
  const reserved = decoder.decode(stream.field());
  const hashAlgorithm = decoder.decode(stream.field());
  const signed = reader(stream.field());
  stream.done();
  const key = reader(publicBlob);
  const keyType = decoder.decode(key.field());
  const publicBytes = key.field();
  key.done();
  const signatureType = decoder.decode(signed.field());
  const signatureBytes = signed.field();
  signed.done();
  if (keyType !== 'ssh-ed25519' || signatureType !== keyType) throw new GitError('Unsupported', 'Unsupported SSH signature key');
  if (actualNamespace !== namespace || reserved !== '') throw new GitError('Conflict', 'SSH signature namespace does not match');
  const publicKey = await crypto.subtle.importKey('raw', publicBytes, 'Ed25519', false, ['verify']);
  const valid = await crypto.subtle.verify('Ed25519', publicKey, signatureBytes,
    await payload(data, { namespace, reserved, hashAlgorithm }));
  const keyText = `ssh-ed25519 ${base64(publicBlob)}`;
  const trusted = allowedKeys ? allowedKeys.some(value => value.trim().split(/\s+/u).slice(0, 2).join(' ') === keyText) : null;
  return { valid, trusted, format: 'ssh', publicKey: keyText, namespace, hashAlgorithm };
}

/** Signing extension policy: OpenPGP is available only through an explicitly supplied provider. */
export async function signCommitPayload(data, options = {}, policy) {
  const format = options.format ?? 'ssh';
  if (format === 'ssh' && options.privateKey) return signSsh(data, options);
  const provider = policy?.signer(format);
  if (!provider) throw new GitError('Unsupported', 'Signing format requires an explicit key provider', { format });
  return provider.sign(data, options);
}

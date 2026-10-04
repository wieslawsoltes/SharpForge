import { CilError } from '../binary.js';
import { CorFlags } from './headers.js';

/** Validate a full RSA/SHA-1 strong-name public key and copy caller-owned storage. */
function publicKeyInfo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 96 || bytes.length > 2080) {
    throw new CilError('Strong-name public key must be a full RSA public key blob (512–16384 bits)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x2400 || view.getUint32(4, true) !== 0x8004
    || view.getUint32(8, true) !== bytes.length - 12 || view.getUint8(12) !== 6 || view.getUint8(13) !== 2
    || view.getUint16(14, true) !== 0 || view.getUint32(16, true) !== 0x2400 || view.getUint32(20, true) !== 0x31415352) {
    throw new CilError('Unsupported strong-name public key: expected an RSA/SHA-1 PUBLICKEYBLOB');
  }
  const bits = view.getUint32(24, true), exponent = view.getUint32(28, true);
  if (bits < 512 || bits > 16384 || bits % 8 || bytes.length !== 32 + bits / 8 || exponent < 3 || !(exponent & 1)
    || !(bytes[32] & 1) || !(bytes.at(-1) & 0x80)) throw new CilError('Invalid strong-name RSA public key parameters');
  return { publicKey: new Uint8Array(bytes), signatureSize: bits / 8 };
}

/** Normalize explicit public/delay-sign inputs. No private key or host key-file access is supported. */
export function strongNameOptions(options) {
  if (options.signAssembly || options.privateKey !== undefined || options.keyFile !== undefined || options.keyContainer !== undefined) {
    throw new CilError('Full RSA strong-name signing is unsupported; use publicKey with publicSign or delaySign');
  }
  for (const name of ['publicSign', 'delaySign']) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean') throw new CilError(`${name} must be boolean`);
  }
  const publicSign = options.publicSign ?? false, delaySign = options.delaySign ?? false;
  if (publicSign && delaySign) throw new CilError('publicSign and delaySign are mutually exclusive');
  if (!publicSign && !delaySign) {
    if (options.publicKey !== undefined) throw new CilError('A strong-name public key requires publicSign or delaySign');
    return undefined;
  }
  return { ...publicKeyInfo(options.publicKey), publicSign };
}

/** Add the Assembly public key and an aligned, zero-filled signature reservation before metadata. */
export function reserveStrongName(section, metadata, strongName) {
  if (!strongName) return undefined;
  const assembly = metadata.rows[32];
  if (assembly?.length !== 1) throw new CilError('Strong-name signing requires exactly one Assembly row');
  assembly[0][5] |= 1;
  assembly[0][6] = metadata.blob(strongName.publicKey);
  section.pad();
  const offset = section.length;
  section.zero(strongName.signatureSize);
  return { offset, size: strongName.signatureSize, publicSign: strongName.publicSign };
}

/** Patch a bounded, zero-filled reservation and set StrongNameSigned only for public signing. */
export function patchStrongNameDirectory(cli, options, sectionLength, metadataOffset, metadataLength) {
  const signature = options.strongNameSignature;
  if (!signature) return;
  const { offset, size, publicSign } = signature;
  const resources = options.resources;
  if (!Number.isSafeInteger(offset) || offset < 72 || offset % 4 || !Number.isSafeInteger(size) || size < 64 || size > 2048
    || offset + size > sectionLength || typeof publicSign !== 'boolean'
    || (offset < metadataOffset + metadataLength && offset + size > metadataOffset)
    || (resources?.size && offset < resources.offset + resources.size && offset + size > resources.offset)) {
    throw new CilError('Invalid CLI strong-name signature range');
  }
  for (let index = offset; index < offset + size; index++) {
    if (cli.getUint8(index)) throw new CilError('Full RSA strong-name signing is unsupported; signature reservation must be zero');
  }
  cli.setUint32(16, options.corFlags | (publicSign ? CorFlags.StrongNameSigned : 0), true);
  cli.setUint32(32, options.firstSectionRva + offset, true);
  cli.setUint32(36, size, true);
}

/** Reconstruct supported signing options from metadata and a zero-filled CLI signature reservation. */
export function canonicalStrongNameOptions(pe) {
  const assembly = pe.metadata.rows[32]?.[0], directory = pe.strongNameSignature;
  const hasPublicKey = !!(assembly?.[5] & 1), publicSign = !!(pe.corFlags & CorFlags.StrongNameSigned);
  if (!hasPublicKey && !directory.size && !publicSign && !assembly?.[6]) return {};
  if (!hasPublicKey || !directory.size) throw new CilError('Invalid canonical strong-name public key or signature directory');
  const { publicKey, signatureSize } = publicKeyInfo(pe.metadata.blob(assembly[6]));
  if (directory.size !== signatureSize) throw new CilError('Invalid canonical strong-name signature size');
  const offset = pe.offsetOf(directory.rva, directory.size);
  for (let index = offset; index < offset + directory.size; index++) {
    if (pe.bytes[index]) throw new CilError('Full RSA strong-name signing is unsupported for canonical source replay');
  }
  return { publicKey, publicSign, delaySign: !publicSign };
}

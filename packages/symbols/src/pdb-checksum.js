import { sha256 } from './hash.js';
import { wideHash } from './hash-wide.js';
import { fail } from './contracts.js';

export const checksumSizes = Object.freeze({ SHA256: 32, SHA384: 48, SHA512: 64 });

export function pdbChecksum(symbols, algorithm = 'SHA256') {
  if (!Object.hasOwn(checksumSizes, algorithm)) fail('Unsupported PDB checksum algorithm: ' + algorithm);
  const bytes = new Uint8Array(symbols.bytes);
  bytes.fill(0, symbols.pdbOffset, symbols.pdbOffset + 20);
  return algorithm === 'SHA256' ? sha256(bytes) : wideHash(bytes, algorithm === 'SHA384' ? 384 : 512);
}

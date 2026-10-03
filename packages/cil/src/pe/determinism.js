import { CilError } from '../binary.js';
import { deterministicContentId } from '../binary/content-id.js';
export { deterministicContentId } from '../binary/content-id.js';
import { readPortableExecutable } from './reader.js';
import { peChecksum } from './checksum.js';

/** Finalize a managed PE copy from its complete zero-identity content, then compute its checksum. */
export function finalizeDeterministicPE(input) {
  if (!(input instanceof Uint8Array) || input.length > 128 * 1024 * 1024) throw new CilError('Invalid deterministic PE input or size limit');
  const bytes = new Uint8Array(input);
  const pe = readPortableExecutable(bytes, { inspection: true, maxBytes: 128 * 1024 * 1024 });
  const mvid = pe.metadata.rows[0]?.[0]?.[2], guids = pe.metadata.streams.get('#GUID');
  if (!mvid || !guids || mvid * 16 > guids.length) throw new CilError('Deterministic PE requires a valid module MVID');
  const mvidOffset = guids.byteOffset - bytes.byteOffset + (mvid - 1) * 16;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bytes.fill(0, mvidOffset, mvidOffset + 16);
  view.setUint32(pe.optionalStart - 16, 0, true);
  view.setUint32(pe.optionalStart + 64, 0, true);
  const { id, timestamp } = deterministicContentId(bytes);
  bytes.set(id, mvidOffset);
  view.setUint32(pe.optionalStart - 16, timestamp, true);
  view.setUint32(pe.optionalStart + 64, peChecksum(bytes), true);
  return bytes;
}

import { CilError, Reader } from '../binary.js';

/** Read one addressed #US record; returned bytes borrow the heap only for the caller's current operation. */
export function userStringEntry(heap, token) {
  if (!Number.isInteger(token) || token < 0x70000001 || token > 0x70ffffff)
    throw new CilError('Invalid user-string token');
  if (!(heap instanceof Uint8Array)) throw new CilError('Invalid user-string heap');
  const offset = token & 0xffffff;
  const reader = new Reader(heap, offset);
  const size = reader.compressed();
  if (size < 1 || (size & 1) !== 1) throw new CilError('Invalid UTF-16 user string');
  const bytes = reader.take(size);
  return { bytes, encodedBytes: reader.position - offset };
}

/** Existing inspection decoding preserves exact UTF-16 code units, including unpaired surrogates. */
export function readUserString(heap, token) {
  const { bytes } = userStringEntry(heap, token);
  let value = '';
  for (let index = 0; index < bytes.length - 1; index += 2)
    value += String.fromCharCode(bytes[index] | (bytes[index + 1] << 8));
  return value;
}

/** ECMA II.24.2.4 marker validation scans bytes without constructing or retaining another string. */
export function validateUserStringMarker(bytes, check) {
  let special = 0;
  for (let index = 0; index < bytes.length - 1; index += 2) {
    if ((index & 1023) === 0) check();
    const low = bytes[index];
    if (bytes[index + 1] || (low >= 1 && low <= 8) || (low >= 14 && low <= 31) || low === 39 || low === 45 || low === 127)
      special = 1;
  }
  check();
  if (bytes[bytes.length - 1] !== special) throw new CilError('Invalid user-string terminal marker');
}

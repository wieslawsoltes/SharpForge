import { CilError } from './error.js';

/** Encode text as UTF-8 bytes using the existing TextEncoder conversion. */
export function utf8(value) {
  return new TextEncoder().encode(value);
}

/** Decode UTF-8; a known native encoding failure is invalid CIL data, while other errors propagate. */
export function text(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return decoder.decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError) || error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
    const failure = new CilError('Invalid UTF-8 text');
    Object.defineProperty(failure, 'cause', { value: error, writable: true, configurable: true });
    throw failure;
  }
}

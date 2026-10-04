import { inflateRaw as decodeRaw } from '@sharpforge/archive';
import { SymbolError } from './contracts.js';

export { deflateStored, deflateRaw } from '@sharpforge/archive';

// The archive decoder currently reports these precise validation failures as plain Error.
// A new message or another exception class remains an implementation finding until explicitly reviewed.
const decoderFailures = new Set([
  'Invalid or oversized compressed symbol data',
  'Truncated DEFLATE stream',
  'Invalid Huffman length',
  'Oversubscribed Huffman tree',
  'Invalid Huffman code',
  'DEFLATE block limit exceeded',
  'Truncated stored block',
  'Invalid stored block',
  'Reserved DEFLATE block',
  'Invalid repeat',
  'Huffman repeat overflow',
  'Missing end-of-block code',
  'DEFLATE output exceeds declared size',
  'Invalid length code',
  'Invalid distance code',
  'Invalid DEFLATE distance or size',
  'DEFLATE length mismatch or trailing input',
]);

/** Decode expected bytes within maxBytes; known malformed DEFLATE yields SF_SYMBOL_INVALID_COMPRESSION. */
export function inflateRaw(input, expected, maxBytes = 64 * 1024 * 1024) {
  try {
    return decodeRaw(input, expected, maxBytes);
  } catch (error) {
    if (!(error instanceof Error) || Object.getPrototypeOf(error) !== Error.prototype
      || error.name !== 'Error' || !decoderFailures.has(error.message)) throw error;
    const failure = new SymbolError(error.message, { code: 'SF_SYMBOL_INVALID_COMPRESSION' });
    Object.defineProperty(failure, 'cause', { value: error, writable: true, configurable: true });
    throw failure;
  }
}

import { binaryRejection } from './binary-guards.js';

// The archive package exposes Error rather than a dedicated error class. Match its explicit diagnostics only.
const validationMessages = new Set([
  'Invalid or oversized ZIP archive',
  'ZIP end directory was not found',
  'ZIP64 archives are not supported',
  'ZIP64 is not supported; use a standard archive under the documented limits',
  'Multi-disk ZIP archives are not supported',
  'Invalid ZIP central directory or entry limit',
  'Invalid ZIP central entry',
  'Truncated or ZIP64 central entry',
  'Encrypted or unsupported ZIP features',
  'Links and special files are not accepted',
  'Truncated ZIP extra field',
  'Invalid or duplicate ZIP extra field',
  'Invalid Unicode ZIP path field',
  'Conflicting ZIP Unicode names',
  'Uncompressed archive size limit exceeded or nonempty directory',
  'Invalid ZIP local header',
  'Central/local ZIP header mismatch',
  'Central/local ZIP size or CRC mismatch',
  'Invalid ZIP data descriptor',
  'ZIP central-directory length mismatch',
  'Archive entry limit exceeded',
  'Overlapping ZIP entries',
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
const diagnosticPrefixes = [
  'Unsafe archive path: ',
  'Non-portable or traversing archive path: ',
  'Duplicate or case-colliding path: ',
  'Case-colliding parent path: ',
  'File/directory path collision: ',
  'ZIP data CRC/length mismatch: ',
];

/** Unknown Error, RangeError and TypeError instances are findings, never blanket malformed-input rejections. */
export function zipFailure(error) {
  if (error instanceof TypeError && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
    return binaryRejection('ZIP_PATH_ENCODING');
  }
  if (error?.constructor !== Error) throw error;
  const message = error.message;
  if (validationMessages.has(message) || diagnosticPrefixes.some(prefix => message.startsWith(prefix)) ||
      /^Unsupported ZIP compression method \d+$/.test(message)) {
    return binaryRejection('ZIP_VALIDATION', message);
  }
  throw error;
}

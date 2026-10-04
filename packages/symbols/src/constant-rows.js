import { fail } from './contracts.js';
import { decodeConstant, constantModifierCount } from './constant-reader.js';
import { metadataName } from './metadata-facts.js';

/** Preflight aggregate blob bytes before copying overlapping signatures or decoding names and values. */
export function readLocalConstants(
  metadata,
  { maxConstantBytes = 16 * 1024 * 1024, maxConstantEntries = 100_000, maxConstantModifiers = 64 } = {},
) {
  if (!Number.isSafeInteger(maxConstantBytes) || maxConstantBytes < 0 || maxConstantBytes > 64 * 1024 * 1024) {
    fail('Invalid local constant byte limit');
  }
  if (!Number.isInteger(maxConstantEntries) || maxConstantEntries < 0 || maxConstantEntries > 1_000_000) {
    fail('Invalid local constant entry limit');
  }
  if (!Number.isInteger(maxConstantModifiers) || maxConstantModifiers < 0 || maxConstantModifiers > 1024) {
    fail('Invalid local constant modifier limit');
  }
  const rows = metadata.rows[52] ?? [];
  if (rows.length > maxConstantEntries) fail('Local constant entry limit exceeded');
  let bytes = 0;
  let entries = rows.length;
  for (const row of rows) {
    const signature = metadata.blob(row[1]);
    bytes += signature.length;
    if (bytes > maxConstantBytes) fail('Local constant byte limit exceeded');
    entries += constantModifierCount(signature, metadata.externalCounts, maxConstantModifiers);
    if (entries > maxConstantEntries) fail('Local constant entry limit exceeded');
  }
  return rows.map((row, index) => {
    const signature = metadata.blob(row[1]);
    const decoded = decodeConstant(signature, {
      counts: metadata.externalCounts,
      maxBytes: maxConstantBytes,
      maxModifiers: maxConstantModifiers,
    });
    return {
      id: index + 1,
      name: metadataName(metadata, row[0], 'Local constant'),
      signature: new Uint8Array(signature),
      ...decoded,
    };
  });
}

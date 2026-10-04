/** A controlled missing-contract test input; the installed reference assembly is never modified. */
import { readPE } from '@sharpforge/cil';

export const nullableContractNames = Object.freeze(['NullableAttribute', 'NullableContextAttribute']);

/**
 * Rename only the requested TypeDef identifiers in a fresh byte copy. Keeping their lengths preserves every
 * metadata offset. Other types and all signatures remain present, unlike an incomplete hand-built framework.
 * This is a projection of the recorded modern reference pack, not a claim to be an actual historical SDK.
 */
export function referenceWithoutNullable(image, names = nullableContractNames) {
  const bytes = Uint8Array.from(image), metadata = readPE(bytes, { inspection: true }).metadata;
  const strings = metadata.streams.get('#Strings'), renamed = [];
  const pending = new Set(names);
  for (const row of metadata.rows[2] ?? []) {
    const name = metadata.string(row[1]);
    if (!pending.has(name) || metadata.string(row[2]) !== 'System.Runtime.CompilerServices') continue;
    if (strings[row[1]] !== 'N'.charCodeAt(0)) throw new Error('Unexpected nullable type identifier');
    strings[row[1]] = 'X'.charCodeAt(0);
    pending.delete(name);
    renamed.push({ from: 'System.Runtime.CompilerServices.' + name, to: 'System.Runtime.CompilerServices.X' + name.slice(1) });
  }
  if (pending.size) throw new Error('The selected reference does not contain: ' + [...pending].join(', '));
  return { bytes, renamed };
}

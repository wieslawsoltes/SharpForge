/** Fresh reference symbols for the controlled missing-nullable-contract input; no normal set is rebound. */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { locateReferencePack } from '../../../packages/compiler/src/node/reference-pack.js';
import { createReferenceSet } from '../../../packages/compiler/src/metadata-import/reference-set.js';
import { referenceWithoutNullable } from './reference-without-nullable.mjs';

let cached;
export function legacyNullableReferences() {
  if (cached !== undefined) return cached;
  const pack = locateReferencePack();
  if (!pack) return cached = null;
  let original, projection;
  const entries = pack.files.map(path => {
    const bytes = readFileSync(path);
    if (basename(path) !== 'System.Runtime.dll') return { bytes, display: path };
    original = bytes;
    projection = referenceWithoutNullable(bytes);
    return { bytes: projection.bytes, display: 'controlled-missing-nullable/System.Runtime.dll' };
  });
  if (!projection) throw new Error('The selected pack does not contain System.Runtime.dll.');
  return cached = { pack, references: createReferenceSet(entries), original, projection };
}

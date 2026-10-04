import { generationError } from './pdb-delta-format.js';

/** Normalize the complete Portable PDB content id without assigning runtime generation identity. */
export function pdbGenerationId(value, name) {
  if (typeof value !== 'string' || !/^[\da-f]{40}$/i.test(value)) {
    generationError('PDB_GENERATION_ID', `Invalid PDB generation ${name}`);
  }
  return value.toLowerCase();
}

import { readPortablePdbCore } from './pdb-reader.js';

/** Read a Roslyn/SRM minimal PDB delta using authoritative aggregate CLI row counts. Throws SymbolError. */
export function readPortablePdbDelta(input, { typeSystemRowCounts, ...options } = {}) {
  return readPortablePdbCore(input, options, { typeSystemRowCounts });
}

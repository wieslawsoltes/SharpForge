import { PortablePdbBuilder, SymbolError, readPortablePdb } from '@sharpforge/symbols';
import { binaryAdmission, binaryFailure, binaryLimits } from './binary-guards.js';
import { createPinnedPortablePdbSeed } from './portable-pdb-pinned-seed.js';
import { createAuthoredPortablePdbSeed } from './portable-pdb-seeds.js';

/** Parse authored symbols and one pinned repository fixture; source fetching and symbol servers are not used. */
export const target = Object.freeze({
  id: 'portable-pdb',
  createSeeds() {
    return [
      { name: 'empty-debug', input: new PortablePdbBuilder().finish({}, 0).bytes },
      createAuthoredPortablePdbSeed(false),
      createAuthoredPortablePdbSeed(true),
      createPinnedPortablePdbSeed(),
    ];
  },
  run(input, context) {
    const limits = binaryLimits(input, context);
    const admission = binaryAdmission(input, limits);
    if (admission) return admission;
    try {
      const symbols = readPortablePdb(input, {
        maxBytes: limits.maxInputBytes,
        maxSourceBytes: limits.maxOutputBytes,
        maxAsyncEntries: 64,
        maxConstantBytes: limits.maxOutputBytes,
        maxConstantEntries: 64,
        maxConstantModifiers: 16,
        signal: limits.signal,
        budgets: {
          documents: 32, methods: 32, scopes: 32, imports: 32, customRecords: 32,
          cdiBytes: limits.maxOutputBytes, embeddedSourceBytes: limits.maxOutputBytes,
        },
      });
      for (const method of symbols.methods) {
        symbols.location(method.token, 0);
        symbols.locals(method.token, 0);
      }
      return { status: 'accepted', code: 'PORTABLE_PDB_PARSED' };
    } catch (error) {
      if (error instanceof SymbolError && error.code === 'SF_SYMBOL_UNSUPPORTED_FORMAT') {
        return { status: 'unsupported', code: error.code };
      }
      return binaryFailure(error, SymbolError, 'PORTABLE_PDB_VALIDATION');
    }
  },
});

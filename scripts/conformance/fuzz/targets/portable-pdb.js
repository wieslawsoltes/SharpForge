import { Writer, codedIndex, token, utf8 } from '@sharpforge/cil';
import { PdbGuids, PortablePdbBuilder, SymbolError, deflateStored, readPortablePdb, sha256, writeSequencePoints } from '@sharpforge/symbols';
import { binaryAdmission, binaryFailure, binaryLimits } from './binary-guards.js';

function sourceSeed(compressed) {
  const builder = new PortablePdbBuilder();
  const source = utf8('int value = 7;\n');
  const name = new Writer().u8(0).compressed(builder.blob(utf8('Fuzz.cs'))).finish();
  const document = builder.add(48, [
    builder.blob(name), builder.guid(PdbGuids.sha256), builder.blob(sha256(source)), builder.guid(PdbGuids.csharp),
  ]);
  const points = writeSequencePoints([
    { document, offset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 15 },
  ], document);
  builder.add(49, [document, builder.blob(points)]);
  builder.add(51, [0, 0, builder.string('value')]);
  builder.add(50, [1, 0, 1, 1, 0, 2]);
  const content = compressed ? deflateStored(source) : source;
  const embedded = new Writer().u32(compressed ? source.length : 0).bytes(content).finish();
  builder.add(55, [
    codedIndex('HasCustomDebugInformation', token(48, document)),
    builder.guid(PdbGuids.embeddedSource), builder.blob(embedded),
  ]);
  return { name: compressed ? 'compressed-source' : 'stored-source', input: builder.finish({ 6: 1 }, 0).bytes };
}

/** Parse self-authored symbol data only; source fetching, external fixtures and symbol servers are not used. */
export const target = Object.freeze({
  id: 'portable-pdb',
  createSeeds() {
    return [
      { name: 'empty-debug', input: new PortablePdbBuilder().finish({}, 0).bytes },
      sourceSeed(false),
      sourceSeed(true),
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

import { Writer, codedIndex, metadataCodedIndices } from '@sharpforge/cil';
import { PortablePdbBuilder, PdbGuids, SymbolError, readPortablePdb, deflateStored } from '@sharpforge/symbols';
import { run as scopeContracts } from '../portable-pdb-unnamed-slots/qualification/browser-scope.mjs';

const unknownKind = '00112233-4455-6677-8899-aabbccddeeff';
const parentTables = metadataCodedIndices.HasCustomDebugInformation[1].filter((table) => table !== null);
const assert = (condition, label) => {
  if (!condition) throw Error(label);
};
function rejects(operation, pattern) {
  try {
    operation();
  } catch (error) {
    assert(error instanceof SymbolError && pattern.test(error.message), `Unexpected ${error.name}: ${error.message}`);
    return;
  }
  throw Error('Expected SymbolError: ' + pattern);
}
function fixture({ documents = 1, methods = 2, scopes = 1, imports = 1, records = 1, payload, kind, change } = {}) {
  const builder = new PortablePdbBuilder();
  const external = Object.fromEntries(parentTables.filter((table) => table < 48).map((table) => [table, 1]));
  external[6] = methods;
  for (let index = 0; index < documents; index++) {
    const segment = builder.blob(new TextEncoder().encode(`Browser${index}.cs`));
    builder.add(48, [builder.blob(new Writer().u8(47).compressed(segment).finish()), 0, 0, 0]);
  }
  for (let index = 0; index < methods; index++) builder.add(49, [0, 0]);
  for (let index = 0; index < scopes; index++) builder.add(50, [1, 0, 1, 1, index, 1]);
  for (let index = 0; index < imports; index++) builder.add(53, [0, 0]);
  builder.add(51, [0, 0, builder.string('local')]);
  builder.add(52, [builder.string('constant'), builder.blob(new Uint8Array([8, 42, 0, 0, 0]))]);
  const parent = kind === PdbGuids.embeddedSource ? 0x30000001 : 1;
  for (let index = 0; index < records; index++)
    builder.add(55, [
      codedIndex('HasCustomDebugInformation', parent),
      builder.guid(kind ?? unknownKind),
      builder.blob(payload ?? new Uint8Array([0xff, 0x80])),
    ]);
  change?.(builder, external);
  return builder.finish(external, 0).bytes;
}

export async function run() {
  const checks = (await scopeContracts()).checks;
  for (const table of parentTables) {
    const valid = fixture({
      change: (builder) => {
        builder.rows[55][0][0] = codedIndex('HasCustomDebugInformation', table * 0x1000000 + 1);
      },
    });
    assert(readPortablePdb(valid).custom[0].parent === table * 0x1000000 + 1, 'Opaque parent identity');
    const invalid = fixture({
      change: (builder) => {
        builder.rows[55][0][0] = codedIndex('HasCustomDebugInformation', table * 0x1000000 + (table === 6 ? 3 : 2));
      },
    });
    rejects(() => readPortablePdb(invalid), /custom debug parent/);
  }
  checks.push('all 27 opaque CDI parent extents');
  for (const [table, column] of [
    [48, 0],
    [48, 2],
    [49, 1],
    [52, 1],
    [53, 1],
    [55, 2],
    [51, 2],
    [52, 0],
    [48, 1],
    [48, 3],
    [55, 1],
  ]) {
    rejects(
      () =>
        readPortablePdb(
          fixture({
            change: (builder) => {
              builder.rows[table][0][column] = 0xffff;
            },
          }),
        ),
      /./,
    );
  }
  rejects(
    () =>
      readPortablePdb(
        fixture({
          change: (builder) => {
            builder.rows[49][0][0] = 2;
          },
        }),
      ),
    /reference/,
  );
  rejects(
    () =>
      readPortablePdb(
        fixture({
          change: (builder) => {
            builder.rows[49][0] = [1, builder.blob(new Uint8Array([2]))];
          },
        }),
      ),
    /local signature/,
  );
  checks.push('all debug heap columns and empty-blob document/local-signature guards');
  for (const name of ['documents', 'methods', 'scopes', 'imports', 'customRecords']) {
    const key = name === 'customRecords' ? 'records' : name;
    const bytes = fixture({ [key]: 2 });
    readPortablePdb(bytes, { budgets: { [name]: 2 } });
    rejects(() => readPortablePdb(bytes, { budgets: { [name]: 1 } }), /budget/);
  }
  checks.push('five count budgets at boundary and limit+1');
  const repeated = fixture({ records: 2 });
  readPortablePdb(repeated, { budgets: { cdiBytes: 4 } });
  rejects(() => readPortablePdb(repeated, { budgets: { cdiBytes: 3 } }), /cdiBytes/);
  for (const compressed of [false, true]) {
    const source = new Uint8Array([65, 66]);
    const payload = new Writer()
      .u32(compressed ? source.length : 0)
      .bytes(compressed ? deflateStored(source) : source)
      .finish();
    const bytes = fixture({ kind: PdbGuids.embeddedSource, payload, records: 2 });
    assert(
      readPortablePdb(bytes, { budgets: { embeddedSourceBytes: 4 } }).custom.every((record) => record.source[1] === 66),
      'Source decode',
    );
    rejects(() => readPortablePdb(bytes, { budgets: { embeddedSourceBytes: 3 } }), /embeddedSourceBytes/);
  }
  checks.push('aggregate CDI and stored/compressed source boundary and limit+1');
  const malformed = fixture({
    kind: PdbGuids.embeddedSource,
    payload: new Writer().u32(2).u8(0xff).finish(),
    records: 2,
  });
  rejects(() => readPortablePdb(malformed, { budgets: { embeddedSourceBytes: 3 } }), /embeddedSourceBytes/);
  rejects(() => readPortablePdb(fixture(), { signal: AbortSignal.abort() }), /cancelled/);
  rejects(() => readPortablePdb(fixture(), { budgets: { documents: Infinity } }), /Invalid symbol parse budget/);
  checks.push('all-source preflight, cancellation and invalid limits');
  return { passed: true, checks };
}

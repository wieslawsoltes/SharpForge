import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Writer, codedIndex, metadataCodedIndices } from '@sharpforge/cil';
import { readPortablePdb, SymbolError, PortablePdbBuilder } from '@sharpforge/symbols';

const opaqueKind = '00112233-4455-6677-8899-aabbccddeeff';
const parentTables = metadataCodedIndices.HasCustomDebugInformation[1].filter((value) => value !== null);
function fixture(change = () => {}, entryPoint = 0) {
  const builder = new PortablePdbBuilder();
  const external = Object.fromEntries(parentTables.filter((table) => table < 48).map((table) => [table, 1]));
  external[6] = 2;
  const segment = builder.blob(new TextEncoder().encode('Fixture.cs'));
  builder.add(48, [builder.blob(new Writer().u8(47).compressed(segment).finish()), 0, 0, 0]);
  builder.add(49, [0, 0]);
  builder.add(49, [0, 0]);
  builder.add(50, [1, 1, 1, 1, 0, 1]);
  builder.add(51, [0, 0, builder.string('local')]);
  builder.add(52, [builder.string('constant'), builder.blob(new Uint8Array([8, 42, 0, 0, 0]))]);
  builder.add(53, [0, 0]);
  builder.add(54, [2, 1]);
  const kind = builder.guid(opaqueKind),
    value = builder.blob(new Uint8Array([0xff, 0x80, 0]));
  for (const table of parentTables)
    builder.add(55, [codedIndex('HasCustomDebugInformation', table * 0x1000000 + 1), kind, value]);
  change(builder, external);
  return builder.finish(external, entryPoint).bytes;
}
const invalid = (operation) =>
  assert.throws(operation, (error) => error instanceof SymbolError && error.name === 'SymbolError');

test('all declared CDI parent tables retain opaque bytes and permit empty import payloads', () => {
  const bytes = fixture(),
    symbols = readPortablePdb(bytes);
  assert.equal(symbols.custom.length, parentTables.length);
  assert.deepEqual(
    symbols.custom.map((record) => record.parent >>> 24),
    parentTables,
  );
  for (const record of symbols.custom) assert.deepEqual(record.bytes, new Uint8Array([0xff, 0x80, 0]));
  assert.deepEqual(symbols.imports[0].definitions, []);
  assert.equal(symbols.constants[0].value, 42);
  symbols.custom[0].bytes[0] = 0;
  assert.equal(readPortablePdb(bytes).custom[0].bytes[0], 0xff);
  assert.equal(
    readPortablePdb(
      fixture((builder) => {
        builder.rows[55][0][2] = 0;
      }),
    ).custom[0].bytes.length,
    0,
  );
});

test('MethodDebugInformation documents are checked even when the sequence-point blob is empty', () => {
  for (const document of [2, 0xffff])
    invalid(() =>
      readPortablePdb(
        fixture((builder) => {
          builder.rows[49][0][0] = document;
        }),
      ),
    );
  assert.equal(
    readPortablePdb(
      fixture((builder) => {
        builder.rows[49][0][0] = 1;
      }),
    ).methods[0].document,
    1,
  );
});

test('opaque CDI parents must belong to declared external or local rows, including zero and invalid coded tags', () => {
  for (const table of parentTables) {
    const limit = table === 6 ? 3 : 2;
    invalid(() =>
      readPortablePdb(
        fixture((builder) => {
          builder.rows[55][0][0] = codedIndex('HasCustomDebugInformation', table * 0x1000000 + limit);
        }),
      ),
    );
  }
  for (const encoded of [0, 31])
    invalid(() =>
      readPortablePdb(
        fixture((builder) => {
          builder.rows[55][0][0] = encoded;
        }),
      ),
    );
});

test('scope, import and state-machine row references reject out-of-range targets and retain legal list sentinels', () => {
  for (const [table, column, value] of [
    [50, 0, 0],
    [50, 0, 3],
    [50, 1, 2],
    [50, 2, 0],
    [50, 2, 3],
    [50, 3, 0],
    [50, 3, 3],
    [53, 0, 2],
    [54, 0, 0],
    [54, 1, 3],
  ]) {
    invalid(() =>
      readPortablePdb(
        fixture((builder) => {
          builder.rows[table][0][column] = value;
        }),
      ),
    );
  }
  const symbols = readPortablePdb(
    fixture((builder) => {
      builder.rows[50][0][2] = 2;
      builder.rows[50][0][3] = 2;
    }),
  );
  assert.deepEqual(symbols.scopes[0].variables, []);
  assert.deepEqual(symbols.scopes[0].constants, []);
});

test('all debug blob, string and GUID handles fail at the public SymbolError boundary', () => {
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
    invalid(() =>
      readPortablePdb(
        fixture((builder) => {
          builder.rows[table][0][column] = 0xffff;
        }),
      ),
    );
  }
  invalid(() =>
    readPortablePdb(
      fixture((builder) => {
        builder.rows[55][0][1] = 0;
      }),
    ),
  );
});

test('nested import blob handles and type/assembly references retain semantic validation', () => {
  for (const bytes of [[1, 0x7f], [3, 7], [3, 9], [2, 2, 0], [0x80]]) {
    invalid(() =>
      readPortablePdb(
        fixture((builder) => {
          builder.rows[53][0][1] = builder.blob(new Uint8Array(bytes));
        }),
      ),
    );
  }
});

test('constant signatures reject truncated scalars and out-of-range type/modifier references as SymbolError', () => {
  for (const bytes of [[], [8], [17, 9], [31, 9, 8, 0, 0, 0, 0]]) {
    invalid(() =>
      readPortablePdb(
        fixture((builder) => {
          builder.rows[52][0][1] = builder.blob(new Uint8Array(bytes));
        }),
      ),
    );
  }
});

test('sequence-point local signatures and nested document blobs are validated without PE binding', () => {
  for (const bytes of [[2], [0x80]]) {
    invalid(() =>
      readPortablePdb(
        fixture((builder) => {
          builder.rows[49][0] = [1, builder.blob(new Uint8Array(bytes))];
        }),
      ),
    );
  }
  invalid(() =>
    readPortablePdb(
      fixture((builder) => {
        builder.rows[48][0][0] = builder.blob(new Uint8Array([47, 0x7f]));
      }),
    ),
  );
  const symbols = readPortablePdb(
    fixture((builder) => {
      builder.rows[49][0] = [1, builder.blob(new Uint8Array([1]))];
    }),
  );
  assert.equal(symbols.methods[0].localSignature, 1);
});

test('PDB entry points are optional bounded MethodDef tokens', () => {
  for (const token of [0x01000001, 0x06000000, 0x06000003]) invalid(() => readPortablePdb(fixture(undefined, token)));
  assert.equal(readPortablePdb(fixture(undefined, 0x06000002)).entryPoint, 0x06000002);
});

test('retained native Roslyn Debug and Release corpora remain readable without rebuilding fixtures', () => {
  for (const [directory, name] of [
    ['portable-pdb-effective-imports', 'EffectiveImports'],
    ['portable-pdb-scope-tree', 'ScopeTree'],
    ['portable-pdb-unnamed-slots', 'UnnamedSlots'],
    ['portable-pdb-local-constants', 'LocalConstants'],
  ]) {
    const symbols = readPortablePdb(readFileSync(new URL(`./fixtures/${directory}/${name}.pdb`, import.meta.url)));
    assert(symbols.documents.length > 0);
    assert(symbols.methods.length > 0);
    assert.equal(symbols.format, 'Portable PDB');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { readPE, token } from '@sharpforge/cil';
import { emitPortablePdb, readPortablePdb, SymbolError } from '@sharpforge/symbols';

const compiled = compileToIL('int value=1; Console.WriteLine(value);', { portablePdb: false });
assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
const pe = readPE(compiled.assembly, { inspection: true });
const methodToken = token(6, 1);
const length = pe.methodBody(methodToken).code.length;
const definitions = [
  { kind: 1, namespace: 'System' },
  { kind: 2, assembly: 1, namespace: 'System' },
  { kind: 3, type: token(1, 1) },
  { kind: 4, alias: 'xml', namespace: 'https://example.test' },
  { kind: 5, alias: 'external' },
  { kind: 6, alias: 'external', assembly: 1 },
  { kind: 7, alias: 'Collections', namespace: 'System.Collections' },
  { kind: 8, alias: 'Imported', assembly: 1, namespace: 'System' },
  { kind: 9, alias: 'Object', type: token(1, 1) },
];
const emit = (debug) => emitPortablePdb(compiled.assembly, debug).bytes;
const method = (constants) => ({ token: methodToken, constants, importScope: 2 });
const imports = [{ definitions: [definitions[5]] }, { parent: 1, definitions }];

test('writer emits every import kind, parent scopes and local constants', () => {
  const constants = [
    { name: 'Flag', type: 'bool', value: true },
    { name: 'Letter', type: 'char', value: 65535 },
    { name: 'Small', type: 'sbyte', value: -128 },
    { name: 'Octet', type: 'byte', value: 255 },
    { name: 'Short', type: 'short', value: -32768 },
    { name: 'UShort', type: 'ushort', value: 65535 },
    { name: 'Int', type: 'int', value: -2147483648 },
    { name: 'UInt', type: 'uint', value: 4294967295 },
    { name: 'Long', type: 'long', value: -(1n << 63n) },
    { name: 'ULong', type: 'ulong', value: (1n << 64n) - 1n },
    { name: 'Float', type: 'float', value: 1.5 },
    { name: 'Double', type: 'double', value: -Infinity },
    { name: 'Text', type: 'string', value: 'hello 𝄞' },
    { name: 'Empty', type: 'string', value: '' },
    { name: 'NullString', type: 'string', value: null },
    { name: 'NullObject', type: 'object', value: null },
  ];
  const symbols = readPortablePdb(emit({ importScopes: imports, methods: [method(constants)] }));
  assert.deepEqual(symbols.imports[1].definitions, definitions);
  assert.equal(symbols.imports[1].parent, 1);
  assert.equal(symbols.scopes[0].importScope, 2);
  assert.deepEqual(
    symbols.constants.map(({ name, type, value }) => ({ name, type, value })),
    constants,
  );
});

test('writer preserves compiler constant signatures and sorts nested scopes', () => {
  const signature = new Uint8Array([8, 42, 0, 0, 0]);
  const symbols = readPortablePdb(
    emit({
      methods: [
        {
          token: methodToken,
          scopes: [
            { start: 1, end: length, constants: [{ name: 'Inner', signature }] },
            {
              start: 0,
              end: length,
              locals: [{ name: 'value', slot: 0 }],
              constants: [{ name: 'Outer', type: 'int', value: 7 }],
            },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(
    symbols.scopes.map((scope) => scope.constants.map((constant) => constant.name)),
    [['Outer'], ['Inner']],
  );
  assert.equal(symbols.scopes[1].constants[0].value, 42);
  assert.deepEqual(symbols.constants[1].signature, signature);
});

test('writer rejects invalid import kinds, forward parents and out-of-range references', () => {
  for (const importScopes of [
    [{ parent: 1 }],
    [{ definitions: [{ kind: 10 }] }],
    [{ definitions: [{ kind: 2, assembly: 0, namespace: 'System' }] }],
    [{ definitions: [{ kind: 3, type: token(6, 1) }] }],
    [{ definitions: [{ kind: 7, alias: 'bad\0alias', namespace: 'System' }] }],
  ])
    assert.throws(() => emit({ importScopes }), SymbolError);
  assert.throws(() => emit({ methods: [method([])] }), /import reference/);
});

test('writer rejects malformed constant values, duplicate names and invalid scopes', () => {
  for (const constant of [
    { type: 'byte', value: 256 },
    { type: 'int', value: 1.5 },
    { type: 'long', value: 1 },
    { type: 'ulong', value: -1n },
    { type: 'bool', value: 1 },
    { type: 'object', value: {} },
    { type: 'unknown', value: 1 },
    { signature: new Uint8Array() },
  ])
    assert.throws(
      () => emit({ methods: [{ token: methodToken, constants: [{ name: 'Invalid', ...constant }] }] }),
      SymbolError,
    );
  assert.throws(
    () =>
      emit({
        methods: [
          {
            token: methodToken,
            constants: [
              { name: 'Same', type: 'int', value: 1 },
              { name: 'Same', type: 'int', value: 2 },
            ],
          },
        ],
      }),
    /duplicate/,
  );
  assert.throws(() => emit({ methods: [{ token: methodToken, scopes: [{ start: 1, end: length }] }] }), /Root/);
  assert.throws(
    () =>
      emit({
        methods: [
          {
            token: methodToken,
            scopes: [
              { start: 0, end: length },
              { start: 1, end: length - 1 },
              { start: 2, end: length },
            ],
          },
        ],
      }),
    /overlapping/,
  );
});

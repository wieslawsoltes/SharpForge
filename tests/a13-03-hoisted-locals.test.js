import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPE, codedIndex } from '@sharpforge/cil';
import { createHoistedLocalLookup } from '../packages/symbols/src/hoisted-locals.js';
import {
  loadSymbols,
  emitPortablePdb,
  attachPortablePdb,
  PdbGuids,
  SymbolError,
  PortablePdbBuilder,
  writeCustomDebugInformation,
} from '@sharpforge/symbols';

const directory = new URL('./fixtures/portable-pdb-hoisted-locals/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('HoistedLocals.dll', directory)));
const pdb = new Uint8Array(readFileSync(new URL('HoistedLocals.pdb', directory)));
const native = fixture.native;
const load = (options) => loadSymbols(assembly, pdb, options);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scopesRecord = (symbols) => symbols.custom.find((record) => record.kind === PdbGuids.hoistedScopes);

function changedScopes(scopes) {
  const bytes = emitPortablePdb(assembly, {
    stateMachines: [{ moveNext: native.moveNext, kickoff: native.kickoff }],
    custom: scopes === null ? [] : [{ parent: native.moveNext, kind: PdbGuids.hoistedScopes, scopes }],
  }).bytes;
  return loadSymbols(attachPortablePdb(assembly, bytes), bytes);
}

test('native fixture identifies the compiler, source, assembly and original Portable PDB', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.match(fixture.reference.compilerVersion, /^5\.3\./);
  assert.match(fixture.reference.compilerSha256, /^[a-f0-9]{64}$/);
  assert.equal(hash(assembly), fixture.reference.assemblySha256);
  assert.equal(hash(pdb), fixture.reference.pdbSha256);
  const source = readFileSync(new URL('../packages/symbols/interop/HoistedLocals/Program.cs', import.meta.url), 'utf8');
  assert.equal(hash(source.replaceAll('\r\n', '\n')), fixture.reference.sourceSha256);
});

test('bound hoisted locals match native field tokens and live ranges at each await', () => {
  const symbols = load();
  assert.equal(symbols.bound, true);
  assert.deepEqual(
    fixture.frames.map((frame) => frame.locals.map((local) => local.name)),
    [['first'], ['first', 'nested'], ['first']],
  );
  for (const frame of fixture.frames) {
    const result = symbols.hoistedLocals(native.moveNext, frame.offset);
    assert.equal(result.available, true);
    assert.equal(result.reason, null);
    assert.deepEqual(result.locals, frame.locals);
    assert.deepEqual(symbols.hoistedLocals(native.kickoff, frame.offset), result);
    for (const local of result.locals) {
      assert.equal(native.fields.find((field) => field.fieldToken === local.fieldToken).fieldName, local.fieldName);
      assert.deepEqual({ start: local.startOffset, end: local.endOffset }, native.scopes[local.slot]);
    }
  }
});

test('scope boundaries are half-open and synthesized zero-length placeholders are omitted', () => {
  const symbols = load();
  const nested = fixture.frames[1].locals.find((local) => local.name === 'nested');
  const names = (offset) => symbols.hoistedLocals(native.moveNext, offset).locals.map((local) => local.name);
  assert(!names(nested.startOffset - 1).includes('nested'));
  assert(names(nested.startOffset).includes('nested'));
  assert(names(nested.endOffset - 1).includes('nested'));
  assert(!names(nested.endOffset).includes('nested'));
  const padded = changedScopes([...native.scopes, { start: 0, end: 0 }]);
  assert.deepEqual(padded.hoistedLocals(native.moveNext, fixture.frames[1].offset).locals, fixture.frames[1].locals);
});

test('missing scope data and unmapped live slots report unavailable without guessing locals', () => {
  const cases = [
    [null, 'missing-hoisted-scopes'],
    [[], 'missing-user-local-scope'],
    [[{ start: 0, end: 0 }, ...native.scopes.slice(1)], 'missing-user-local-scope'],
    [[...native.scopes, { ...native.scopes[0] }], 'unsupported-hoisted-local-slot'],
  ];
  for (const [scopes, reason] of cases) {
    const result = changedScopes(scopes).hoistedLocals(native.moveNext, fixture.frames[0].offset);
    assert.equal(result.available, false);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.locals, []);
  }
});

test('unknown methods, unsupported field conventions and unbound symbols are explicit', () => {
  assert.equal(load().hoistedLocals(0x06ffffff, 0).reason, 'not-state-machine');
  const bytes = new Uint8Array(assembly);
  const pe = readPE(bytes, { inspection: true });
  const field = pe.metadata.rows[4].find((row) => pe.metadata.string(row[1]) === '<>1__state');
  const offset = pe.metadata.streams.get('#Strings').byteOffset - bytes.byteOffset + field[1];
  bytes[offset] = 120;
  const unsupported = loadSymbols(bytes, pdb).hoistedLocals(native.moveNext, 0);
  assert.equal(unsupported.reason, 'unsupported-field-convention');
  assert.deepEqual(unsupported.locals, []);
  const unboundBytes = new Uint8Array(assembly);
  const directoryOffset = pe.optionalStart + (pe.pe32Plus ? 112 : 96) + 6 * 8;
  unboundBytes.fill(0, directoryOffset, directoryOffset + 8);
  const unbound = loadSymbols(unboundBytes, pdb, { allowUnbound: true });
  unbound.bound = true;
  assert.equal(unbound.hoistedLocals(native.moveNext, 0).reason, 'unbound-symbols');
});

test('invalid ranges and duplicate scope records cannot produce a mapping', () => {
  const length = readPE(assembly, { inspection: true }).methodBody(native.moveNext).code.length;
  const scopes = native.scopes.map((scope) => ({ ...scope }));
  scopes[0].end = length + 1;
  assert.throws(() => changedScopes(scopes).hoistedLocals(native.moveNext, 0), /Invalid hoisted local scope range/);
  const builder = new PortablePdbBuilder();
  const pe = readPE(assembly, { inspection: true });
  builder.add(54, [native.moveNext & 0xffffff, native.kickoff & 0xffffff]);
  const row = [
    codedIndex('HasCustomDebugInformation', native.moveNext),
    builder.guid(PdbGuids.hoistedScopes),
    builder.blob(writeCustomDebugInformation(PdbGuids.hoistedScopes, { scopes: native.scopes })),
  ];
  builder.add(55, row);
  builder.add(55, row);
  const duplicate = builder.finish(pe.metadata.counts, pe.entryPoint).bytes;
  assert.throws(
    () => loadSymbols(attachPortablePdb(assembly, duplicate), duplicate),
    /Duplicate hoisted local scope record/,
  );
});

test('lookup snapshots are bounded at load and independent of caller data before the first query', () => {
  assert.throws(() => load({ maxHoistedEntries: 1 }), /index entry limit exceeded/);
  const original = load();
  const counts = readPE(assembly, { inspection: true }).metadata.counts;
  let entries = original.stateMachines.length * 2 + original.custom.length;
  for (const table of [2, 4, 6]) entries += counts[table] ?? 0;
  for (const record of original.custom) if (record.kind === PdbGuids.hoistedScopes) entries += record.scopes.length;
  assert.throws(() => load({ maxHoistedEntries: entries }), /index entry limit exceeded/);
  assert.deepEqual(
    load({ maxHoistedEntries: entries + 2 }).hoistedLocals(native.moveNext, fixture.frames[1].offset).locals,
    fixture.frames[1].locals,
  );
  const bytes = new Uint8Array(assembly);
  const pdbBytes = new Uint8Array(pdb);
  const symbols = loadSymbols(bytes, pdbBytes);
  bytes.fill(0);
  pdbBytes.fill(0);
  scopesRecord(symbols).scopes[0].end = 0;
  symbols.custom.push({ ...scopesRecord(symbols) });
  symbols.stateMachines[0].moveNext = 0;
  symbols.stateMachines.length = 0;
  const result = symbols.hoistedLocals(native.moveNext, fixture.frames[1].offset);
  assert.deepEqual(result.locals, fixture.frames[1].locals);
  result.locals[0].name = 'changed';
  result.locals.push({ name: 'injected' });
  assert.deepEqual(symbols.hoistedLocals(native.moveNext, fixture.frames[1].offset).locals, fixture.frames[1].locals);
  assert.deepEqual(load().hoistedLocals(native.moveNext, fixture.frames[1].offset).locals, fixture.frames[1].locals);
});

test('query arguments and index limits are validated', () => {
  const symbols = load();
  for (const [token, offset] of [
    [0, 0],
    [0x02000001, 0],
    [0x106000001, 0],
    [native.moveNext, -1],
    [native.moveNext, NaN],
  ]) {
    assert.throws(() => symbols.hoistedLocals(token, offset), SymbolError);
  }
  for (const maxHoistedEntries of [-1, NaN, 1.5, 1_000_001]) {
    assert.throws(() => load({ maxHoistedEntries }), /Invalid hoisted local index limit/);
  }
});

test('malformed pointer ownership is rejected before field expansion', () => {
  const symbols = load();
  for (const [method, message] of [
    [native.moveNext, /Ambiguous hoisted local method ownership/],
    [0x106000001, /Invalid hoisted local method ownership token/],
    [0x06ffffff, /Invalid hoisted local method ownership token/],
  ]) {
    const metadata = { counts: { 2: 2, 4: 1, 6: native.moveNext & 0xffffff }, list: () => [method] };
    assert.throws(() => createHoistedLocalLookup({ metadata }, symbols), message);
  }
});

test('field name bytes are bounded before decoding even with overlapping heap indices', () => {
  const symbols = load();
  const heap = new Uint8Array(4097).fill(65);
  heap[heap.length - 1] = 0;
  const metadata = {
    counts: { 2: 1, 4: 2, 6: native.moveNext & 0xffffff },
    streams: new Map([['#Strings', heap]]),
    list: (_owner, column) => (column === 'MethodList' ? [native.moveNext] : [0x04000001, 0x04000002]),
    row: (token) => [0, token & 0xffffff],
    string: () => {
      throw Error('decoded before byte limit');
    },
  };
  assert.throws(() => createHoistedLocalLookup({ metadata }, symbols), /Hoisted field name exceeds length limit/);
});

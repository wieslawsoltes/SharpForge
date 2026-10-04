import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MetadataBuilder,
  Writer,
  encodeSignature,
  readPE,
  readMethodHeader,
  writeMethodBody,
  writePE,
} from '@sharpforge/cil';
import { PortablePdbBuilder } from '../packages/symbols/src/pdb-builder.js';
import { attachPortablePdb, emitPortablePdb, loadSymbols, readPortablePdb } from '@sharpforge/symbols';

const primitive = (name) => ({ kind: 'primitive', name });
function fixture({
  types = [primitive('int'), primitive('string')],
  scopes = [],
  tiny = false,
  noBody = false,
  extraTypes = null,
} = {}) {
  const metadata = new MetadataBuilder('UnnamedSlots');
  const signature = types.length ? metadata.add(17, [metadata.blob(encodeSignature({ kind: 'locals', types }))]) : 0;
  if (extraTypes) metadata.add(17, [metadata.blob(encodeSignature({ kind: 'locals', types: extraTypes }))]);
  metadata.add(2, [1, metadata.string('Fixture'), 0, 0, 1, 1]);
  metadata.add(6, [noBody ? 0 : 0x2048, 0, 0x16, metadata.string('Run'), metadata.blob(new Uint8Array([0, 0, 1])), 1]);
  const bytes = metadata.finish();
  const body = tiny ? new Uint8Array([6, 0x2a]) : writeMethodBody(new Uint8Array([0x2a]), signature, 1);
  const section = new Writer().zero(72).bytes(body).pad();
  const offset = section.length;
  section.bytes(bytes);
  const assembly = writePE(section.finish(), offset, bytes.length, 0);
  const pdb = emitPortablePdb(assembly, { methods: [{ token: 0x06000001, scopes }] }).bytes;
  return { assembly: attachPortablePdb(assembly, pdb), rawAssembly: assembly, pdb, signature };
}

test('public header-only reader returns owned tiny/fat facts without decoding exception sections', () => {
  const input = fixture(),
    pe = readPE(input.assembly, { inspection: true });
  const header = readMethodHeader(pe, 0x06000001),
    body = pe.methodBody(0x06000001);
  for (const key of ['fileOffset', 'headerSize', 'maxStack', 'localSignature', 'initLocals'])
    assert.equal(header[key], body[key]);
  assert.equal(header.codeSize, 1);
  assert.equal(header.localSignature, input.signature);
  assert.equal(
    Object.values(header).some((value) => value && typeof value === 'object'),
    false,
  );
  header.localSignature = 0;
  assert.equal(readMethodHeader(pe, 0x06000001).localSignature, input.signature);
  pe.bytes[header.fileOffset] |= 8;
  assert.equal(readMethodHeader(pe, 0x06000001).moreSections, true);
  assert.throws(() => pe.methodBody(0x06000001), /method data section|EH/);
  const tiny = readMethodHeader(readPE(fixture({ types: [], tiny: true }).assembly), 0x06000001);
  assert.equal(tiny.headerSize, 1);
  assert.equal(tiny.localSignature, 0);
  assert.equal(tiny.maxStack, 8);
  assert.equal(readMethodHeader(readPE(fixture({ noBody: true }).assembly), 0x06000001), null);
});

test('header reader rejects raw token, RVA, short header and code extent boundaries', () => {
  for (const token of [0, -1, 0x04000001, 0x06000002, 0x106000001, 1n, Symbol('token')]) {
    assert.throws(() => readMethodHeader(readPE(fixture().assembly), token), /MethodDef/);
  }
  for (const rva of [-1, 0x100000000, 1.5]) {
    const pe = readPE(fixture().assembly);
    pe.metadata.rows[6][0][0] = rva;
    assert.throws(() => readMethodHeader(pe, 0x06000001), /RVA/);
  }
  const pe = readPE(fixture().assembly),
    at = readMethodHeader(pe, 0x06000001).fileOffset;
  pe.bytes[at + 1] = 0x20;
  assert.throws(() => readMethodHeader(pe, 0x06000001), /fat method header/);
  pe.bytes[at + 1] = 0x30;
  pe.bytes.fill(0xff, at + 4, at + 8);
  assert.throws(() => readMethodHeader(pe, 0x06000001), /RVA|section|extent|range/);
});

test('bound slots without LocalVariable rows expose null names and declared types without invented scopes', () => {
  const input = fixture(),
    symbols = loadSymbols(input.assembly, input.pdb);
  assert.deepEqual(symbols.scopeTree(0x06000001), []);
  assert.deepEqual(symbols.locals(0x06000001, 0), []);
  const result = symbols.localSlots(0x06000001);
  assert.equal(result.available, true);
  assert.deepEqual(
    result.slots.map(({ index, name, typeName, unnamed, declarations }) => ({
      index,
      name,
      typeName,
      unnamed,
      declarations,
    })),
    [
      { index: 0, name: null, typeName: 'int', unnamed: true, declarations: [] },
      { index: 1, name: null, typeName: 'string', unnamed: true, declarations: [] },
    ],
  );
  result.slots[0].type.name = 'Changed';
  symbols.methods[0].localSignature = 0xffffff;
  assert.equal(symbols.localSlots(0x06000001).slots[0].type.name, 'int');
  assert.deepEqual(readPortablePdb(input.pdb).localSlots(0x06000001), {
    available: false,
    reason: 'type-metadata-required',
    slots: [],
  });
});

test('recorded declarations and hidden flags are preserved while reused slots never choose an invented name', () => {
  const input = fixture({
    scopes: [
      {
        start: 0,
        end: 1,
        locals: [
          { slot: 0, name: 'first' },
          { slot: 1, name: 'generated', hidden: true },
        ],
      },
      { start: 0, end: 1, locals: [{ slot: 0, name: 'second' }] },
    ],
  });
  const symbols = loadSymbols(input.assembly, input.pdb);
  const [reused, hidden] = symbols.localSlots(0x06000001).slots;
  assert.equal(reused.name, null);
  assert.equal(reused.unnamed, false);
  assert.deepEqual(
    reused.declarations.map((value) => value.name),
    ['first', 'second'],
  );
  assert.equal(hidden.name, 'generated');
  assert.equal(hidden.declarations[0].compilerGenerated, true);
  reused.declarations[0].name = 'Changed';
  symbols.variables[0].name = 'AlsoChanged';
  assert.equal(symbols.localSlots(0x06000001).slots[0].declarations[0].name, 'first');
});

test('an empty tiny-method signature differs from missing method metadata and invalid query tokens', () => {
  const tiny = fixture({ types: [], tiny: true }),
    absent = fixture({ types: [], noBody: true });
  assert.deepEqual(loadSymbols(tiny.assembly, tiny.pdb).localSlots(0x06000001), {
    available: true,
    reason: null,
    slots: [],
  });
  const symbols = loadSymbols(absent.assembly, absent.pdb);
  assert.deepEqual(symbols.localSlots(0x06000001), { available: false, reason: 'no-method-body', slots: [] });
  for (const token of [0, -1, 0x06000002, 0x106000001, 1n, Symbol('method')]) {
    assert.throws(() => symbols.localSlots(token), /method token/);
    assert.throws(() => readPortablePdb(absent.pdb).localSlots(token), /method token/);
  }
});

test('slot method/aggregate bounds and cancellation precede slot materialization', () => {
  const input = fixture();
  for (const options of [
    { maxLocalSlotMethods: 0 },
    { maxLocalSlots: 1 },
    { maxLocalSlots: NaN },
    { maxLocalSlots: 100001 },
  ]) {
    assert.throws(() => loadSymbols(input.assembly, input.pdb, options), /local slot|Local slot/);
  }
  assert.throws(() => loadSymbols(input.assembly, input.pdb, { signal: AbortSignal.abort() }), /cancelled/);
  const controller = new AbortController();
  const symbols = loadSymbols(input.assembly, input.pdb, { signal: controller.signal });
  controller.abort();
  assert.throws(() => symbols.localSlots(0x06000001), /cancelled/);
  const wide = fixture({ types: Array.from({ length: 100 }, () => primitive('int')) });
  assert.throws(() => loadSymbols(wide.assembly, wide.pdb, { maxLocalSlots: 99 }), /aggregate limit/);
});

test('unnamed-slot inspection validates method-header signature tokens before dereferencing rows', () => {
  const input = fixture(),
    pe = readPE(input.assembly),
    header = readMethodHeader(pe, 0x06000001);
  new DataView(input.assembly.buffer, input.assembly.byteOffset).setUint32(header.fileOffset + 8, 0x12000001, true);
  assert.throws(() => loadSymbols(input.assembly, input.pdb), /local signature token/);
});

import { readFileSync } from 'node:fs';
test('Release CLR slot types and SRM declarations match without reconstructing eliminated variables', () => {
  const directory = new URL('./fixtures/portable-pdb-unnamed-slots/', import.meta.url);
  const reference = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
  assert.equal(reference.reference.mode, 'Release');
  assert.equal(reference.reference.optimized, true);
  const symbols = loadSymbols(
    readFileSync(new URL('UnnamedSlots.dll', directory)),
    readFileSync(new URL('UnnamedSlots.pdb', directory)),
  );
  for (const method of reference.native.methods) {
    const result = symbols.localSlots(method.token);
    assert.equal(result.available, true);
    assert.deepEqual(
      result.slots.map(({ type, ...slot }) => slot),
      method.slots,
    );
    for (const slot of result.slots) if (slot.unnamed) assert.equal(slot.name, null);
  }
  assert(reference.native.methods.find((method) => method.name === 'Sum').slots.some((slot) => slot.unnamed));
  assert.equal(reference.native.methods.find((method) => method.name === 'Gone').slots.length, 0);
});

test('CLI headers are authoritative when in-range PDB signatures disagree or bodies are absent', () => {
  const input = fixture({ extraTypes: [primitive('bool')] });
  const metadata = readPE(input.rawAssembly).metadata;
  const pdb = new PortablePdbBuilder();
  pdb.add(49, [0, pdb.blob(new Uint8Array([2]))]);
  const mismatch = pdb.finish(metadata.counts, 0).bytes;
  assert.throws(() => loadSymbols(attachPortablePdb(input.rawAssembly, mismatch), mismatch), /local signatures differ/);
  const absent = fixture({ noBody: true });
  const noBody = readPE(absent.rawAssembly);
  const missing = new PortablePdbBuilder();
  missing.add(49, [0, missing.blob(new Uint8Array([1]))]);
  const bytes = missing.finish(noBody.metadata.counts, 0).bytes;
  assert.throws(() => loadSymbols(attachPortablePdb(absent.rawAssembly, bytes), bytes), /requires a CIL method body/);
});

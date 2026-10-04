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
import { attachPortablePdb, emitPortablePdb, loadSymbols, readPortablePdb } from '@sharpforge/symbols';

const primitive = (name) => ({ kind: 'primitive', name });
function fixture({ types = [primitive('int'), primitive('string')], scopes = [], tiny = false, noBody = false } = {}) {
  const metadata = new MetadataBuilder('UnnamedSlots');
  const signature = types.length ? metadata.add(17, [metadata.blob(encodeSignature({ kind: 'locals', types }))]) : 0;
  metadata.add(2, [1, metadata.string('Fixture'), 0, 0, 1, 1]);
  metadata.add(6, [noBody ? 0 : 0x2048, 0, 0x16, metadata.string('Run'), metadata.blob(new Uint8Array([0, 0, 1])), 1]);
  const bytes = metadata.finish();
  const body = tiny ? new Uint8Array([6, 0x2a]) : writeMethodBody(new Uint8Array([0x2a]), signature, 1);
  const section = new Writer().zero(72).bytes(body).pad();
  const offset = section.length;
  section.bytes(bytes);
  const assembly = writePE(section.finish(), offset, bytes.length, 0);
  const pdb = emitPortablePdb(assembly, { methods: [{ token: 0x06000001, scopes }] }).bytes;
  return { assembly: attachPortablePdb(assembly, pdb), pdb, signature };
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

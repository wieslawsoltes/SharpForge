import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, verifyCilMethodTypes } from '@sharpforge/cil';
import { literalFixture } from './fixtures/verifier-literals/input.js';
import { withMetadataStreams } from './support/il-document-metadata.js';

function verify(fixture, options) {
  const input = literalFixture(fixture);
  return verifyCilMethodTypes(input.bytes, input.method, options);
}

function invalid(fixture) {
  const report = verify(fixture);
  assert.equal(report.status, 'rejected', JSON.stringify(report));
  assert.equal(report.diagnostics[0].code, 'CILT0001');
  assert.equal(report.diagnostics[0].diagnostic, 'StringOperand');
  assert.equal(report.diagnostics[0].offset, 0);
  return report;
}

test('ldstr requires a nonzero #US token and an in-range record start', () => {
  for (const token of [0, 0x70000000, 0x01000001, 0x06000001, 0x71000001, 0x70ffffff, 0xffffffff]) {
    invalid({ body: writer => writer.op('ldstr', token).op('ret') });
  }
  invalid({ rawHeap: Uint8Array.of(0), body: writer => writer.op('ldstr', 0x70000001).op('ret') });
});

test('empty, even-length, truncated and reserved compressed #US records reject', () => {
  const records = [
    [], [0], [2, 65, 0], [3, 65, 0], [5, 65, 0, 66, 0],
    [0x80], [0xc0], [0xc0, 0], [0xc0, 0, 0], [0xe0], [0xff],
    [0x80, 0x81, 65, 0, 0], [0xc0, 0, 0x40, 1], [0xdf, 0xff, 0xff, 0xff],
  ];
  for (const record of records) invalid({ rawHeap: Uint8Array.of(0, ...record) });
});

test('missing #US rejects only when a String literal actually needs the heap', () => {
  const literal = literalFixture();
  const missing = withMetadataStreams(literal.bytes, streams => streams.delete('#US'));
  const report = verifyCilMethodTypes(missing, literal.method);
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'StringOperand');
  const empty = literalFixture({ result: 'void', body: writer => writer.op('ret') });
  const noHeap = withMetadataStreams(empty.bytes, streams => streams.delete('#US'));
  assert.equal(verifyCilMethodTypes(noHeap, empty.method).status, 'verified');
});

test('every single-byte character follows the ECMA terminal-marker categories', () => {
  for (let code = 0; code <= 255; code++) {
    const special = (code >= 1 && code <= 8) || (code >= 14 && code <= 31) || [39, 45, 127].includes(code) ? 1 : 0;
    const rawHeap = Uint8Array.of(0, 3, code, 0, special);
    assert.equal(verify({ rawHeap }).status, 'verified', String(code));
    rawHeap[4] ^= 1;
    invalid({ rawHeap });
  }
  for (const marker of [1, 2, 255]) invalid({ rawHeap: Uint8Array.of(0, 1, marker) });
  assert.equal(verify({ rawHeap: Uint8Array.of(0, 1, 0) }).status, 'verified');
});

test('high bytes and paired or lone surrogates preserve exact UTF-16 units', () => {
  for (const text of ['\u0100', '\uffff', '\ud800', '\udfff', 'A🚀\ud800B\udfff\0']) {
    const input = literalFixture({ text });
    const inspector = new AssemblyInspector(input.bytes);
    assert.equal(verifyCilMethodTypes(inspector, input.method).status, 'verified');
    assert.equal(inspector.metadata.userString(input.literalTokens[0]), text);
    const heap = inspector.metadata.streams.get('#US');
    assert.equal(heap[heap.length - 1], 1);
    heap[heap.length - 1] = 0;
    const report = verifyCilMethodTypes(inspector, input.method);
    assert.equal(report.status, 'rejected');
    assert.equal(report.diagnostics[0].diagnostic, 'StringOperand');
  }
});

test('compressed length boundaries charge the complete one-, two- and four-byte record', () => {
  for (const [length, width] of [[0, 1], [63, 1], [64, 2], [8191, 2], [8192, 4]]) {
    const input = literalFixture({ text: 'x'.repeat(length) });
    const bytes = width + length * 2 + 1;
    assert.equal(new AssemblyInspector(input.bytes).metadata.streams.get('#US').length, bytes + 1);
    assert.equal(verifyCilMethodTypes(input.bytes, input.method, { maxStringLiteralBytes: bytes }).status, 'verified');
    const limited = verifyCilMethodTypes(input.bytes, input.method, { maxStringLiteralBytes: bytes - 1 });
    assert.equal(limited.status, 'unknown');
    assert.equal(limited.diagnostics[0].code, 'CILDF0001');
  }
});

test('only addressed records are inspected, including unreachable literal operands', () => {
  const fixture = { rawHeap: Uint8Array.of(0, 3, 65, 0, 0, 0xff), text: 'A' };
  assert.equal(verify(fixture).status, 'verified');
  const unreachable = { ...fixture, result: 'void', body(writer) {
    writer.op('ret').op('ldstr', 0x70000005).op('pop').op('ret');
  } };
  const report = verify(unreachable);
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'StringOperand');
  assert.equal(report.diagnostics[0].offset, 1);
});

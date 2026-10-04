import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, verifyCilMethodTypes } from '@sharpforge/cil';
import { literalFixture } from './fixtures/verifier-literals/input.js';

function verify(fixture, options) {
  const input = literalFixture(fixture);
  return verifyCilMethodTypes(input.bytes, input.method, options);
}

function unknown(report, code = 'CILDF0001') {
  assert.equal(report.status, 'unknown', JSON.stringify(report));
  assert.equal(report.diagnostics[0].code, code);
}

test('literal count and byte limits have explicit defaults, zero boundaries and hard ceilings', () => {
  for (const name of ['maxStringLiterals', 'maxStringLiteralBytes']) {
    const ceiling = name === 'maxStringLiterals' ? 65535 : 1048576;
    assert.equal(verify({}, { [name]: ceiling }).status, 'verified');
    for (const value of [0, -1, NaN, Infinity, '1', 1.5, ceiling + 1]) unknown(verify({}, { [name]: value }));
  }
  const empty = { result: 'void', body: writer => writer.op('ret') };
  assert.equal(verify(empty, { maxStringLiterals: 0, maxStringLiteralBytes: 0 }).status, 'verified');
  assert.equal(verify(empty, { maxStringLiterals: NaN, maxStringLiteralBytes: NaN }).status, 'verified');
});

test('repeated loads of one token consume one record while distinct tokens consume distinct work', () => {
  const repeated = { result: 'void', body(writer, input) {
    for (let index = 0; index < 256; index++) writer.op('ldstr', input.literal('A')).op('pop');
    writer.op('ret');
  } };
  assert.equal(verify(repeated, { maxStringLiterals: 1, maxStringLiteralBytes: 4 }).status, 'verified');
  unknown(verify(repeated, { maxStringLiteralBytes: 3 }));
  const distinct = { result: 'void', rawHeap: Uint8Array.of(0, 3, 65, 0, 0, 3, 65, 0, 0), body(writer) {
    writer.op('ldstr', 0x70000001).op('pop').op('ldstr', 0x70000005).op('pop').op('ret');
  } };
  assert.equal(verify(distinct, { maxStringLiterals: 2, maxStringLiteralBytes: 8 }).status, 'verified');
  unknown(verify(distinct, { maxStringLiterals: 1 }));
  unknown(verify(distinct, { maxStringLiteralBytes: 7 }));
});

test('per-invocation literal budgets apply again after a successful cached-inspector verification', () => {
  const input = literalFixture({ text: 'A' });
  const inspector = new AssemblyInspector(input.bytes);
  const options = { maxStringLiterals: 1, maxStringLiteralBytes: 4 };
  for (let iteration = 0; iteration < 3; iteration++)
    assert.equal(verifyCilMethodTypes(inspector, input.method, options).status, 'verified');
  unknown(verifyCilMethodTypes(inspector, input.method, { maxStringLiteralBytes: 3 }));
});

test('byte-work limits stop before scanning oversized text and before block propagation', () => {
  const large = { text: 'a'.repeat(524285) };
  assert.equal(verify(large).status, 'verified');
  unknown(verify({ text: 'a'.repeat(524286) }));
  const unreachable = { result: 'void', body(writer, input) {
    writer.op('ret').op('ldstr', input.literal('A')).op('pop').op('ret');
  } };
  unknown(verify(unreachable, { maxStringLiterals: 0 }));
});

test('pre-cancellation and cancellation during a long terminal-marker scan never qualify a method', () => {
  unknown(verify({}, { signal: AbortSignal.abort() }), 'CILDF0002');
  let armed = false;
  let checks = 0;
  const options = {
    get maxStringLiteralBytes() {
      armed = true;
      return 1048576;
    },
    signal: { get aborted() { return armed && ++checks >= 4; } },
  };
  const report = verify({ text: 'a'.repeat(8192) }, options);
  unknown(report, 'CILDF0002');
  assert.equal(report.diagnostics[0].offset, 0);
  assert.equal(checks, 4);
});

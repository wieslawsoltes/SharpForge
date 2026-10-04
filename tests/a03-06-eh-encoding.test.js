import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPE, writeMethodBody, exceptionEncodingDiagnosticCatalog } from '@sharpforge/cil';
import { exceptionFixture } from './support/exception-encoding.js';

const errorCode = code => error => error.name === 'CilError' && error.code === code;
const clause = { flags: 0, start: 0, end: 1, target: 1, handlerEnd: 2, catchType: 0x01000001 };
const sectionOffset = code => (12 + code.length + 3) & ~3;

test('filter and fault payloads round trip through small, fat and automatic sections', () => {
  for (const kind of ['filter', 'fault']) {
    for (const exceptionFormat of ['fat', 'small', 'auto']) {
      const fixture = exceptionFixture({ kind, exceptionFormat });
      const body = readPE(fixture.assembly, { inspection: true }).methodBody(fixture.methodToken);
      assert.deepEqual(body.code, fixture.code);
      assert.equal(body.handlers.length, fixture.handlers.length);
      for (const [index, expected] of fixture.handlers.entries()) {
        const { filterOffset, catchType = 0, flags, ...range } = expected;
        const actual = body.handlers[index];
        assert.deepEqual(actual, { ...range, catchType: filterOffset ?? catchType, flags,
          kind: { 0: 'catch', 1: 'filter', 4: 'fault' }[flags] });
      }
      const first = fixture.body[sectionOffset(fixture.code)];
      assert.equal(Boolean(first & 0x40), exceptionFormat === 'fat');
      assert.equal(Boolean(first & 0x80), false);
    }
  }
});

test('legacy fat bytes and filter union payload remain compatible', () => {
  const code = Uint8Array.of(0, 0x2a);
  const expected = '1b3001000200000000000000002a0000411c0000000000000000000001000000010000000100000001000001';
  assert.equal(Buffer.from(writeMethodBody(code, 0, 1, [clause])).toString('hex'), expected);
  const fixture = exceptionFixture();
  const legacy = fixture.handlers.map(({ filterOffset, ...item }) => ({ ...item, catchType: filterOffset }));
  const localToken = new DataView(fixture.body.buffer).getUint32(8, true);
  assert.deepEqual(writeMethodBody(fixture.code, localToken, 1, legacy), fixture.body);
  assert.equal(new DataView(writeMethodBody(code, 0, 0).buffer).getUint16(2, true), 1);
});

test('small section boundaries include UInt16 offsets, byte lengths and twenty clauses', () => {
  const bytes = new Uint8Array(65791);
  const boundary = { ...clause, end: 255, target: 65535, handlerEnd: 65790 };
  const small = writeMethodBody(bytes, 0, 1, [boundary], { exceptionFormat: 'small' });
  assert.equal(small[sectionOffset(bytes)], 1);
  for (const changed of [{ end: 256 }, { target: 65536, handlerEnd: 65791 }, { handlerEnd: 65791 }]) {
    assert.throws(() => writeMethodBody(bytes, 0, 1, [{ ...boundary, ...changed }], { exceptionFormat: 'small' }), errorCode('CILEH0003'));
    assert.equal(writeMethodBody(bytes, 0, 1, [{ ...boundary, ...changed }], { exceptionFormat: 'auto' })[sectionOffset(bytes)], 0x41);
  }
  const code = Uint8Array.of(0, 0x2a);
  for (const count of [20, 21]) {
    const body = writeMethodBody(code, 0, 1, Array(count).fill(clause), { exceptionFormat: 'auto' });
    assert.equal(body[sectionOffset(code)], count === 20 ? 1 : 0x41);
  }
  assert.throws(() => writeMethodBody(code, 0, 1, [clause, clause], { clausesPerSection: 1 }), errorCode('CILEH0005'));
});

test('malformed flags, payloads, ranges, headers and section limits fail before encoding', () => {
  const code = Uint8Array.of(0, 0x2a);
  for (const changed of [{ flags: 3 }, { start: -1 }, { end: 0 }, { end: 3 }, { target: 1.5 },
    { handlerEnd: 1 }, { catchType: 0 }, { catchType: 0x06000001 }, { flags: 2, catchType: 1 },
    { flags: 4, catchType: 1 }, { flags: 1, catchType: 1 }, { flags: 1, filterOffset: 0, catchType: 1 }]) {
    assert.throws(() => writeMethodBody(code, 0, 1, [{ ...clause, ...changed }]), errorCode('CILEH0001'));
  }
  for (const maxStack of [-1, 65536, 1.5, NaN]) assert.throws(() => writeMethodBody(code, 0, maxStack), errorCode('CILEH0001'));
  for (const token of [1, 0x11000000, 0x10000001, 0x100000000]) assert.throws(() => writeMethodBody(code, token, 1), errorCode('CILEH0001'));
  for (const options of [{ maxClauses: 0 }, { maxClauses: 1000001 }]) {
    assert.throws(() => writeMethodBody(code, 0, 1, [clause], options), errorCode('CILEH0002'));
  }
  assert.throws(() => writeMethodBody(code, 0, 1, [], { exceptionFormat: 'tiny' }), errorCode('CILEH0001'));
  assert.deepEqual(Object.keys(exceptionEncodingDiagnosticCatalog), ['CILEH0001', 'CILEH0002', 'CILEH0003', 'CILEH0004', 'CILEH0005']);
});

test('caller byte ownership and cancellation are preserved', () => {
  const backing = Buffer.from([99, 0, 0x2a, 98]);
  const input = backing.subarray(1, 3);
  const body = writeMethodBody(input, 0, 1);
  input.fill(1);
  assert.deepEqual([...body.subarray(12)], [0, 0x2a]);
  body.fill(0);
  assert.deepEqual([...backing], [99, 1, 1, 98]);
  assert.throws(() => writeMethodBody(input, 0, 1, [], { signal: AbortSignal.abort() }), errorCode('CILEH0004'));
  let checks = 0;
  const signal = { get aborted() { return ++checks === 3; } };
  assert.throws(() => writeMethodBody(input, 0, 1, [clause, clause], { signal }), errorCode('CILEH0004'));
});

test('native CoreCLR executes filter and fault fixtures and SRM reads every encoded region', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/eh-encoding/native.json', import.meta.url), 'utf8'));
  assert.match(reference.runtime, /^\.NET /);
  for (const [name, hash] of Object.entries(reference.sourceSha256)) {
    const bytes = readFileSync(new URL(`./fixtures/eh-encoding/oracle/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, name);
  }
  assert.equal(reference.cases.length, 6);
  for (const item of reference.cases) {
    const fixture = exceptionFixture(item.options);
    assert.equal(createHash('sha256').update(fixture.assembly).digest('hex'), item.sha256);
    if (item.options.nativeChained) {
      assert.equal(item.result, null);
      assert.equal(item.error, 'System.NullReferenceException');
      assert.equal(item.regions.length, 1, 'Native SRM observes only the first section');
      assert.equal(readPE(fixture.assembly, { inspection: true }).methodBody(fixture.methodToken).handlers.length, 2);
      continue;
    }
    assert.equal(item.error, null);
    assert.equal(item.result, fixture.expected);
    assert.deepEqual(item.regions, fixture.handlers.map(handler => ({
      kind: { 0: 'Catch', 1: 'Filter', 4: 'Fault' }[handler.flags], tryOffset: handler.start,
      tryLength: handler.end - handler.start, handlerOffset: handler.target,
      handlerLength: handler.handlerEnd - handler.target,
      catchType: handler.flags === 0 ? handler.catchType : 0,
      filterOffset: handler.flags === 1 ? handler.filterOffset : -1,
    })));
  }
});

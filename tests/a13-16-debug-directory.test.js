import test from 'node:test';
import assert from 'node:assert/strict';
import { CilError, inspectPE, readPE, readPEDebugDirectory } from '@sharpforge/cil';
import { SymbolError, readDebugDirectory } from '@sharpforge/symbols';
import { peFixture, codeView, viewOf } from './fixtures/pe-inspection/input.mjs';

test('raw debug entries retain unknown kinds, independent RVAs and overlay payloads as owned bytes', () => {
  const fixture = peFixture({ debug: [
    { kind: 42, bytes: new Uint8Array([1, 2, 255]), dataRva: 0, characteristics: 0x12345678 },
    { kind: 16, bytes: new Uint8Array(), dataRva: 0xdeadbeef },
  ] });
  const bytes = Buffer.from(fixture.bytes);
  const pe = readPE(bytes);
  const entries = readPEDebugDirectory(pe);
  assert.deepEqual(entries.map(entry => entry.kind), [42, 16]);
  assert.equal(entries[0].characteristics, 0x12345678);
  assert.equal(entries[0].dataRva, 0);
  assert.ok(entries[0].offset >= pe.sections.at(-1).offset + pe.sections.at(-1).size);
  assert.equal(entries[1].dataRva, 0xdeadbeef);
  assert.deepEqual(entries[0].bytes, new Uint8Array([1, 2, 255]));
  const report = inspectPE(bytes);
  assert.equal(report.debugDirectory[0].payload, '0102ff');
  assert.equal(report.debugDirectory[0].kindName, 'Unknown');
  assert.equal(report.debugDirectory[1].payload, '');
  bytes.fill(0, entries[0].offset, entries[0].offset + 3);
  assert.deepEqual(entries[0].bytes, new Uint8Array([1, 2, 255]));
  entries[0].bytes[0] = 9;
  assert.equal(bytes[entries[0].offset], 0);
  // This raw API retains reserved Characteristics; native PEReader rejects nonzero values.
  assert.equal(report.debugDirectory[0].characteristics, 0x12345678);
});

test('symbols reuses raw record extraction while retaining CodeView semantic decoding and error type', () => {
  const { bytes } = peFixture({ debug: [{ kind: 2, bytes: codeView('symbols.pdb'), minor: 0x504d }] });
  const raw = readPEDebugDirectory(readPE(bytes));
  const decoded = readDebugDirectory(bytes);
  assert.equal(raw[0].path, undefined);
  assert.equal(decoded[0].path, 'symbols.pdb');
  assert.equal(decoded[0].age, 1);
  assert.deepEqual(decoded[0].bytes, raw[0].bytes);
  assert.equal(inspectPE(bytes).debugDirectory[0].kindName, 'CodeView');
  const pe = readPE(bytes);
  viewOf(bytes).setUint32(pe.optionalStart + 96 + 6 * 8 + 4, 27, true);
  assert.throws(() => readPEDebugDirectory(readPE(bytes)), CilError);
  assert.throws(() => readDebugDirectory(bytes), SymbolError);
});

test('raw debug entry and aggregate payload limits admit exact bounds and reject excess', () => {
  const { bytes } = peFixture({ debug: [{ bytes: new Uint8Array([1, 2]) }, { bytes: new Uint8Array([3, 4, 5]) }] });
  const pe = readPE(bytes);
  assert.equal(readPEDebugDirectory(pe, { maxEntries: 2, maxDataBytes: 5 }).length, 2);
  assert.equal(inspectPE(bytes, { maxDebugEntries: 2, maxDebugBytes: 5 }).debugDirectory.length, 2);
  assert.throws(() => readPEDebugDirectory(pe, { maxEntries: 1 }), /entry limit/);
  assert.throws(() => readPEDebugDirectory(pe, { maxDataBytes: 4 }), /payload byte limit/);
  assert.throws(() => inspectPE(bytes, { maxDebugBytes: 4 }), /payload byte limit/);
  assert.throws(() => inspectPE(bytes, { maxDebugEntries: 1 }), /entry limit/);
  for (const options of [null, [], { maxEntries: -1 }, { maxEntries: 65537 }, { maxDataBytes: NaN }])
    assert.throws(() => readPEDebugDirectory(pe, options), CilError);
  assert.throws(() => readPEDebugDirectory({}), /parsed PE/);
  assert.deepEqual(readPEDebugDirectory(readPE(peFixture().bytes), { maxEntries: 0, maxDataBytes: 0 }), []);
});

test('debug payload truncation and cancellation reject before exposing partial output', () => {
  const { bytes, debugRecords } = peFixture({ debug: [{ bytes: new Uint8Array([1, 2]) }] });
  const pe = readPE(bytes);
  assert.throws(() => readPEDebugDirectory(pe, { signal: AbortSignal.abort() }), /cancelled/);
  let checks = 0;
  assert.throws(() => readPEDebugDirectory(pe, { signal: { get aborted() { return ++checks > 1; } } }), /cancelled/);
  viewOf(bytes).setUint32(debugRecords[0].recordOffset + 24, bytes.length - 1, true);
  assert.throws(() => readPEDebugDirectory(pe), /Truncated debug entry/);
  assert.throws(() => readDebugDirectory(bytes), SymbolError);
  assert.throws(() => inspectPE(bytes), /Truncated debug entry/);
});

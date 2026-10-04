import test from 'node:test';
import assert from 'node:assert/strict';
import * as symbols from '@sharpforge/symbols';

const publicExports = [
  'SourceStatus', 'createSourceFetcher', 'PdbGuids', 'PortablePdbBuilder', 'SymbolError', 'attachPortablePdb', 'bindSources',
  'decodeSource', 'deflateStored', 'emitPortablePdb', 'guidBytes', 'guidString', 'hex', 'inflateRaw',
  'loadSymbols', 'readDebugDirectory', 'readPortablePdb', 'readSequencePoints',
  'sha1', 'sha256', 'sourceLinkUrl', 'sourceSpan', 'verifySource', 'verifySourceAsync', 'resolveSources',
  'writeSequencePoints', 'readCustomDebugInformation', 'writeCustomDebugInformation',
  'portablePdbKey', 'peSymbolKey', 'createSymbolServer',
];

test('symbols entry point preserves the published exports after extraction', () => {
  assert.deepEqual(Object.keys(symbols).sort(), publicExports.sort());
});

test('independent symbol builders keep heaps and failures isolated', () => {
  const first = new symbols.PortablePdbBuilder();
  const second = new symbols.PortablePdbBuilder();
  first.string('only-in-first');
  assert.throws(() => first.guid('invalid'), symbols.SymbolError);
  const independent = symbols.readPortablePdb(second.finish({}, 0).bytes);
  assert.deepEqual(independent.documents, []);
  assert.deepEqual(independent.methods, []);
  assert.equal(second.strings.length, 1);
  assert.equal(second.guids.length, 0);
});

test('extracted source helpers retain UTF-16 offsets and empty-source boundaries', () => {
  assert.deepEqual(symbols.sourceSpan('𝄞\nnext', 3, 7), {
    line: 2, column: 1, endLine: 2, endColumn: 5,
  });
  assert.deepEqual(symbols.sourceSpan('', 0, 0), {
    line: 1, column: 1, endLine: 1, endColumn: 2,
  });
  assert.throws(() => symbols.guidString(new Uint8Array(15)), symbols.SymbolError);
});

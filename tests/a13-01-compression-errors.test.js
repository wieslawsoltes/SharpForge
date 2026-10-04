import test from 'node:test';
import assert from 'node:assert/strict';
import { Writer, codedIndex, token, utf8 } from '@sharpforge/cil';
import { PdbGuids, PortablePdbBuilder, SymbolError, deflateStored, inflateRaw, readPortablePdb } from '@sharpforge/symbols';

function pdbForCompressedSource(payload, expected = 3) {
  const builder = new PortablePdbBuilder();
  const name = new Writer().u8(0).compressed(builder.blob(utf8('Compression.cs'))).finish();
  const document = builder.add(48, [builder.blob(name), 0, 0, builder.guid(PdbGuids.csharp)]);
  const embedded = new Writer().u32(expected).bytes(payload).finish();
  builder.add(55, [
    codedIndex('HasCustomDebugInformation', token(48, document)), builder.guid(PdbGuids.embeddedSource), builder.blob(embedded),
  ]);
  return builder.finish({}, 0).bytes;
}

function compressionError(message) {
  return error => {
    assert(error instanceof SymbolError);
    assert.equal(error.code, 'SF_SYMBOL_INVALID_COMPRESSION');
    assert.equal(error.message, message);
    assert.equal(Object.getPrototypeOf(error.cause), Error.prototype);
    assert.equal(error.cause.message, message);
    assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
    return true;
  };
}

test('public Portable PDB reader reports malformed embedded DEFLATE through SymbolError', () => {
  const fixtures = [
    [Uint8Array.of(7), 'Reserved DEFLATE block'],
    [new Uint8Array(), 'Truncated DEFLATE stream'],
    [Uint8Array.of(1), 'Truncated stored block'],
    [Uint8Array.of(1, 1, 0, 0, 0), 'Invalid stored block'],
    [Uint8Array.of(3, 0), 'DEFLATE length mismatch or trailing input'],
  ];
  for (const [payload, message] of fixtures) {
    const input = pdbForCompressedSource(payload);
    assert(input.length < 1024);
    const before = input.slice();
    assert.throws(() => readPortablePdb(input, { maxBytes: 1024, maxSourceBytes: 64 }), compressionError(message));
    assert.deepEqual(input, before);
  }
});

test('public symbol DEFLATE retains positive output, offset views and existing byte limits', () => {
  const source = utf8('abc');
  const compressed = deflateStored(source);
  const padded = new Uint8Array(compressed.length + 2);
  padded.set(compressed, 1);
  assert.deepEqual(inflateRaw(padded.subarray(1, -1), source.length, source.length), source);
  assert.throws(() => inflateRaw(compressed, source.length, source.length - 1),
    compressionError('Invalid or oversized compressed symbol data'));
  const input = pdbForCompressedSource(compressed);
  const parsed = readPortablePdb(input, { maxBytes: input.length, maxSourceBytes: compressed.length });
  assert.deepEqual(parsed.documents[0].embedded, source);
  assert.throws(() => readPortablePdb(input, { maxBytes: input.length - 1 }), SymbolError);
  assert.throws(() => readPortablePdb(input, { maxSourceBytes: compressed.length - 1 }), SymbolError);
});

test('public symbol decoder preserves unknown errors and unexpected classes even with familiar messages', () => {
  const renamed = new Error('Reserved DEFLATE block');
  renamed.name = 'ImplementationInvariant';
  for (const failure of [new Error('Unknown decoder invariant'), new TypeError('Reserved DEFLATE block'),
    new RangeError('Truncated DEFLATE stream'), renamed]) {
    class FaultingInput extends Uint8Array {
      get length() { throw failure; }
    }
    assert.throws(() => inflateRaw(new FaultingInput([3, 0]), 0, 16), error => error === failure);
  }
});

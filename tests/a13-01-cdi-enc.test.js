import test from 'node:test';
import assert from 'node:assert/strict';
import { PdbGuids, readCustomDebugInformation as decode, writeCustomDebugInformation as encode } from '@sharpforge/symbols';

const cases = [
  [PdbGuids.encSlots, [255, 5, 0, 1, 0, 130, 25, 2], {
    syntaxOffsetBaseline: -5, slots: [{ kind: null }, { kind: 0, syntaxOffset: -5, ordinal: 0 },
      { kind: 1, syntaxOffset: 20, ordinal: 2 }],
  }],
  [PdbGuids.encLambdas, [3, 5, 1, 0, 8, 0, 10, 1, 15, 2], {
    methodOrdinal: 2, syntaxOffsetBaseline: -5, closures: [{ syntaxOffset: -5 }],
    lambdas: [{ syntaxOffset: 3, closureOrdinal: -2 }, { syntaxOffset: 5, closureOrdinal: -1 },
      { syntaxOffset: 10, closureOrdinal: 0 }],
  }],
  [PdbGuids.encStates, [3, 5, 0x7d, 0, 0, 5, 2, 5], {
    syntaxOffsetBaseline: -5, states: [{ stateNumber: -2, syntaxOffset: -5, relativeOrdinal: 0 },
      { stateNumber: 0, syntaxOffset: 0, relativeOrdinal: 0 }, { stateNumber: 1, syntaxOffset: 0, relativeOrdinal: 1 }],
  }],
];

for (const [kind, data, expected] of cases) {
  test('EnC CDI structured round trip: ' + kind, () => {
    const bytes = new Uint8Array(data);
    assert.deepEqual(decode(kind, bytes), expected);
    assert.deepEqual(encode(kind, expected), bytes);
  });
}

test('EnC codecs reject malformed counts, closures, slots and ordering', () => {
  for (const [kind, data] of [
    [PdbGuids.encSlots, [1]], [PdbGuids.encSlots, [64, 0]],
    [PdbGuids.encLambdas, [0, 1, 0, 0, 2]], [PdbGuids.encLambdas, [0, 1, 127]],
    [PdbGuids.encStates, [0, 0]], [PdbGuids.encStates, [2, 0, 0, 4, 2, 3]],
  ]) assert.throws(() => decode(kind, new Uint8Array(data)));
  assert.throws(() => decode(PdbGuids.encSlots, new Uint8Array([0, 0]), { maxRecords: 1 }), /limit/);
  assert.throws(() => encode(PdbGuids.encLambdas, { methodOrdinal: 0, closures: [],
    lambdas: [{ syntaxOffset: 0, closureOrdinal: 0 }] }), /closure ordinal/);
});

test('EnC state signed compression covers all encoded width boundaries', () => {
  const states = [-0x10000000, -8193, -8192, -65, -64, -1, 0, 63, 64, 8191, 8192, 0xfffffff]
    .map((stateNumber, syntaxOffset) => ({ stateNumber, syntaxOffset, relativeOrdinal: 0 }));
  assert.deepEqual(decode(PdbGuids.encStates, encode(PdbGuids.encStates, { states })).states, states);
});

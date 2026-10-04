import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { codedIndex, token } from '@sharpforge/cil';
import {
  readPortablePdb,
  emitPortablePdb,
  PortablePdbBuilder,
  writeCustomDebugInformation,
  PdbGuids,
} from '@sharpforge/symbols';
import { createAsyncInfoLookup } from '../packages/symbols/src/async-info.js';

const directory = new URL('./fixtures/portable-pdb-async-writer/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('AsyncWriter.dll', directory)));
const records = fixture.records.map(({ moveNext, kickoff, steps }) => ({
  moveNext,
  kickoff,
  ...(steps ? { catchHandlerOffset: steps.catchHandlerOffset, awaits: steps.awaits } : {}),
}));
const bytes = emitPortablePdb(assembly, { stateMachines: records }).bytes;
const expected = (record) => ({
  stateMachine: { moveNext: record.moveNext, kickoff: record.kickoff },
  steps: record.steps?.awaits ?? [],
});

function synthetic(pairs, parents) {
  const builder = new PortablePdbBuilder();
  for (const [moveNext, kickoff] of pairs) builder.add(54, [moveNext, kickoff]);
  for (const parent of parents)
    builder.add(55, [
      codedIndex('HasCustomDebugInformation', token(6, parent)),
      builder.guid(PdbGuids.asyncSteps),
      builder.blob(
        writeCustomDebugInformation(PdbGuids.asyncSteps, {
          awaits: [{ yieldOffset: 1, resumeOffset: 2, resumeMethod: token(6, 1) }],
        }),
      ),
    ]);
  return builder.finish({ 6: 8 }, 0).bytes;
}

test('kickoff and MoveNext async information both match the existing native SRM fixture', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.reference.generatedPdbSha256);
  const symbols = readPortablePdb(bytes);
  for (const record of fixture.records) {
    assert.deepEqual(symbols.asyncInfo(record.moveNext), expected(record));
    assert.deepEqual(symbols.asyncInfo(record.kickoff), expected(record));
  }
});

test('async information owns its facts before the first query and returns fresh state and await records', () => {
  const input = new Uint8Array(bytes);
  const symbols = readPortablePdb(input);
  input.fill(0);
  for (const pair of symbols.stateMachines) pair.moveNext = 0;
  symbols.stateMachines.length = 0;
  for (const record of symbols.custom)
    if (record.kind === PdbGuids.asyncSteps) {
      record.awaits[0].yieldOffset = 0xffffffff;
      record.awaits.length = 0;
    }
  symbols.custom.length = 0;
  for (const record of fixture.records) {
    const first = symbols.asyncInfo(record.kickoff);
    assert.deepEqual(first, expected(record));
    first.stateMachine.kickoff = 0;
    if (first.steps.length) first.steps[0].resumeOffset = 0xffffffff;
    first.steps.push({ injected: true });
    assert.deepEqual(symbols.asyncInfo(record.moveNext), expected(record));
  }
});

test('table-only iterator links and independent stepping records retain their result shapes', () => {
  const symbols = readPortablePdb(synthetic([[1, 2]], [3]));
  assert.deepEqual(symbols.asyncInfo(token(6, 2)), {
    stateMachine: { moveNext: token(6, 1), kickoff: token(6, 2) },
    steps: [],
  });
  assert.deepEqual(symbols.asyncInfo(token(6, 3)), {
    stateMachine: null,
    steps: [{ yieldOffset: 1, resumeOffset: 2, resumeMethod: token(6, 1) }],
  });
  for (const unknown of [token(6, 8), 0, undefined, 'method']) {
    assert.deepEqual(symbols.asyncInfo(unknown), { stateMachine: null, steps: [] });
  }
});

test('duplicate stepping parents and ambiguous method aliases are rejected instead of selecting the first', () => {
  assert.throws(() => readPortablePdb(synthetic([], [1, 1])).asyncInfo(token(6, 1)), /Duplicate async information/);
  for (const pairs of [
    [[1, 1]],
    [
      [1, 2],
      [2, 3],
    ],
  ]) {
    assert.throws(() => readPortablePdb(synthetic(pairs, [])).asyncInfo(token(6, 1)), /Ambiguous async information/);
  }
});

test('aggregate entry limits apply before snapshots and allow exact boundaries', () => {
  const input = synthetic([[1, 2]], [1, 3]);
  assert.throws(() => readPortablePdb(input, { maxAsyncEntries: 5 }), /entry limit exceeded/);
  assert.equal(readPortablePdb(input, { maxAsyncEntries: 6 }).asyncInfo(token(6, 2)).steps.length, 1);
  assert.deepEqual(readPortablePdb(synthetic([], []), { maxAsyncEntries: 0 }).asyncInfo(0), {
    stateMachine: null,
    steps: [],
  });
  for (const maxAsyncEntries of [-1, NaN, 1.5, 1_000_001]) {
    assert.throws(() => readPortablePdb(bytes, { maxAsyncEntries }), /Invalid async information entry limit/);
  }
  const guarded = { kind: PdbGuids.asyncSteps, awaits: new Array(10) };
  Object.defineProperty(guarded, 'parent', {
    get() {
      throw Error('snapshotted before budget');
    },
  });
  assert.throws(
    () => createAsyncInfoLookup([], [guarded], { maxAsyncEntries: 10, methodCount: 8 }),
    /entry limit exceeded/,
  );
});

test('stepping parents and resume methods must fit the external MethodDef table', () => {
  const record = { kind: PdbGuids.asyncSteps, parent: token(6, 1), awaits: [] };
  for (const parent of [0, 0x106000001, token(6, 9)]) {
    assert.throws(
      () => createAsyncInfoLookup([], [{ ...record, parent }], { methodCount: 8 }),
      /Invalid async information MethodDef/,
    );
  }
  assert.throws(
    () =>
      createAsyncInfoLookup(
        [],
        [{ ...record, awaits: [{ yieldOffset: 0, resumeOffset: 0, resumeMethod: token(6, 9) }] }],
        { methodCount: 8 },
      ),
    /Invalid async information MethodDef/,
  );
});

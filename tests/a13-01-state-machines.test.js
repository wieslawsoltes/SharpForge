import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { token } from '@sharpforge/cil';
import { emitPortablePdb, readPortablePdb, PdbGuids } from '@sharpforge/symbols';

const compiled = compileToIL(
  'class Program { static void Main() { Console.WriteLine(1); } static void Kickoff() {} static void MoveNext() {} }',
  { portablePdb: false },
);
assert(compiled.success, JSON.stringify(compiled.diagnostics));
const pair = { moveNext: token(6, 3), kickoff: token(6, 2) };
const custom = { parent: token(6, 2), kind: PdbGuids.encSlots, slots: [{ kind: 0, syntaxOffset: 12, ordinal: 0 }] };

test('writer emits state-machine links and typed CDI with external method references', () => {
  const symbols = readPortablePdb(
    emitPortablePdb(compiled.assembly, { stateMachines: [pair], custom: [custom] }).bytes,
  );
  assert.deepEqual(symbols.stateMachines, [pair]);
  assert.deepEqual(symbols.asyncInfo(pair.moveNext).stateMachine, pair);
  assert.deepEqual(symbols.custom[0].slots, custom.slots);
  assert.equal(symbols.custom[0].parent, pair.kickoff);
});

test('writer rejects duplicate or invalid state-machine and CDI references', () => {
  const emit = (debug) => emitPortablePdb(compiled.assembly, debug);
  assert.throws(() => emit({ stateMachines: [pair, pair] }), /Duplicate state machine/);
  assert.throws(() => emit({ stateMachines: [{ ...pair, moveNext: token(6, 100) }] }), /Invalid state machine/);
  assert.throws(() => emit({ stateMachines: [{ ...pair, kickoff: token(2, 1) }] }), /Invalid state machine/);
  assert.throws(() => emit({ custom: [custom, custom] }), /Duplicate custom debug/);
  assert.throws(() => emit({ custom: [{ ...custom, parent: token(6, 100) }] }), /Invalid custom debug parent/);
});

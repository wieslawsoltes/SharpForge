import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly, verifiedStackBound, mergeVerifiedStackReports} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture() {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', maxStack: 0, body: writer => writer.op('ret')},
    {name: 'Callback', result: 'int', maxStack: 1, body: writer => writer.op('ldc.i4.1').op('ret')}
  ]}]);
  const inspector = new AssemblyInspector(bytes);
  const callback = [...inspector.methods.values()].find(method => method.name === 'Callback').token;
  return {bytes, inspector, callback, initial: verifyCilAssembly(inspector),
    additional: verifyCilAssembly(inspector, {methodToken: callback})};
}

test('A15 verified callback report union preserves private exact stack proofs without modifying predecessors', () => {
  const {inspector, initial, additional, callback} = fixture();
  const method = inspector.getMethod(callback);
  assert.equal(verifiedStackBound(inspector, initial, method), null);
  const merged = mergeVerifiedStackReports(inspector, initial, additional);
  assert.equal(initial.methods.includes(callback), false);
  assert.equal(merged.methods.includes(callback), true);
  assert.deepEqual(verifiedStackBound(inspector, merged, method), {capacity: 1, peak: 1});
  assert.deepEqual(verifiedStackBound(inspector, merged, inspector.getMethod(initial.entryPoint)), {capacity: 0, peak: 0});
  assert.equal(verifiedStackBound(inspector, {...merged}, method), null);
});

test('A15 verified callback report union rejects foreign inspectors, copied reports and added unproven tokens', () => {
  const {inspector, initial, additional, callback} = fixture();
  const foreign = fixture();
  assert.throws(() => mergeVerifiedStackReports(inspector, initial, foreign.additional), /this inspector/);
  assert.throws(() => mergeVerifiedStackReports(inspector, initial, {...additional}), /privately verified/);
  initial.methods = [...initial.methods, callback];
  assert.throws(() => mergeVerifiedStackReports(inspector, initial, additional), /body changed/);
});

test('A15 verified callback report union rejects changed instructions and bounded-union overflow', () => {
  const {inspector, initial, additional, callback} = fixture();
  assert.throws(() => mergeVerifiedStackReports(inspector, initial, additional, {maxMethods: 1}), /union limit/);
  const method = inspector.getMethod(callback);
  method.instructions[0].name = 'ldc.i4.2';
  assert.throws(() => mergeVerifiedStackReports(inspector, initial, additional), /body changed/);
  assert.equal(verifiedStackBound(inspector, additional, method), null);
});

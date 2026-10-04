import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, CilDispatchTable, asyncStateMachine, verifyCilAssembly} from '@sharpforge/cil';
import {genericMachineFixture} from './fixtures/cil-async/generic-machine-fixture.mjs';

test('CIL generic async callback proof accepts exact closed explicit implementations', () => {
  const inspector = new AssemblyInspector(genericMachineFixture());
  const report = verifyCilAssembly(inspector);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const machine = asyncStateMachine(inspector, 'Fixture.Machine`1<int>');
  assert.equal(machine.moveNext, 0x06000002);
  assert.equal(machine.setStateMachine, 0x06000003);
  assert.ok(new CilDispatchTable(inspector).table('Fixture.Machine`1<int>'));
});

test('CIL generic async callback-only methods cannot use an out-of-range type variable', () => {
  const report = verifyCilAssembly(genericMachineFixture({outOfRangeVariable: true}));
  assert.equal(report.success, false);
  assert.ok(report.issues.some(issue => issue.methodToken === 0x06000002), JSON.stringify(report.issues));
});

test('CIL generic async builder calls cannot instantiate a machine with the wrong arity', () => {
  const report = verifyCilAssembly(genericMachineFixture({wrongArity: true}));
  assert.equal(report.success, false);
  assert.ok(report.issues.some(issue => issue.methodToken === 0x06000001), JSON.stringify(report.issues));
});

for (const [name, options] of [
  ['declaration return', {badReturn: true}],
  ['declaration parameter', {badParameter: true}],
  ['substituted implementation parameter', {substitutedBody: true}],
  ['untrusted declaration assembly', {declarationAssembly: 'Impostor.Runtime'}],
  ['wrong declaration public key', {declarationAssembly: 'System.Threading.Tasks', wrongKey: true}],
  ['untrusted same-name implementation parameter', {untrustedBodyParameter: true}],
]) test('CIL constructed async MethodImpl rejects ' + name, () => {
  const inspector = new AssemblyInspector(genericMachineFixture(options));
  const report = verifyCilAssembly(inspector);
  assert.equal(report.success, false, name);
  assert.throws(() => asyncStateMachine(inspector, 'Fixture.Machine`1<int>'));
});

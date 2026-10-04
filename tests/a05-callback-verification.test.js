import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly, verifiedStackBound} from '@sharpforge/cil';
import {managedFixture} from './managed-fixtures.js';

test('callback verification extends authentic proofs without losing the original entry roots', () => {
  const inspector = new AssemblyInspector(managedFixture({methods: [
    {name: 'Main', body: writer => writer.op('ret')},
    {name: 'Callback', result: 'string', body(writer, context) {
      writer.op('ldstr', 0x70000000 + context.md.userString('callback')).op('ret');
    }}
  ]}));
  const original = verifyCilAssembly(inspector);
  const callback = [...inspector.methods.values()].find(method => method.name === 'Callback');
  assert(!original.methods.includes(callback.token));
  const report = verifyCilAssembly(inspector, {additionalMethodTokens: [callback.token, callback.token]});
  assert.equal(report.success, true, JSON.stringify(report.issues));
  assert.equal(report.entryPoint, original.entryPoint);
  assert(original.methods.every(token => report.methods.includes(token)));
  assert(verifiedStackBound(inspector, report, inspector.getMethod(callback.token)));
  assert(verifiedStackBound(inspector, report, inspector.getMethod(original.entryPoint)));
  assert.throws(() => verifyCilAssembly(inspector, {additionalMethodTokens: [0x01000001]}), /MethodDef/);
  assert.throws(() => verifyCilAssembly(inspector, {additionalMethodTokens: [0x106000001]}), /MethodDef/);
  assert.throws(() => verifyCilAssembly(inspector, {additionalMethodTokens: [callback.token], maxMethods: 0}), /method limit/);
  assert.throws(() => verifyCilAssembly(inspector, {additionalMethodTokens: new Set([callback.token])}), /method limit/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { decodedInspectorMethod } from '../packages/cil/src/inspector-method.js';
import { managedFixture } from './managed-fixtures.js';

const token = 0x06000001;
function fixture() {
  return managedFixture({ name: 'MethodViews', entry: null, methods: [{ name: 'Text', body(writer, context) {
    writer.op('ldstr', 0x70000000 + context.md.userString('literal')).op('pop').op('br.s', 'done');
    writer.mark('done').op('ret');
  } }] });
}
function countedInspector() {
  const inspector = new AssemblyInspector(fixture());
  const read = inspector.pe.methodBody;
  let count = 0;
  inspector.pe.methodBody = token => { count++; return read(token); };
  return { inspector, count: () => count };
}

test('public-only method inspection retains original display shape/order and cache identity', () => {
  const { inspector, count } = countedInspector();
  const method = inspector.getMethod(token);
  assert.equal(method.instructions[0].operandText, '"literal"');
  assert.equal(method.instructions[2].operandText, 'IL_0008');
  assert.deepEqual(Object.keys(method.instructions[0]).slice(-3), ['label', 'operandText', 'point']);
  assert.strictEqual(inspector.getMethod(token), method);
  assert.strictEqual(decodedInspectorMethod(inspector, token), method);
  assert.equal(inspector.decodedMethods, undefined);
  assert.equal(count(), 1);
});

test('typed-first decoding defers display work and public promotion evicts the interim raw entry', () => {
  const { inspector, count } = countedInspector();
  const raw = decodedInspectorMethod(inspector, token);
  assert.equal(Object.hasOwn(raw.instructions[0], 'operandText'), false);
  assert.strictEqual(decodedInspectorMethod(inspector, token), raw);
  assert.equal(inspector.cache.has(token), false);
  assert.equal(inspector.decodedMethods.size, 1);
  const described = inspector.getMethod(token);
  assert.notStrictEqual(described, raw);
  assert.equal(described.instructions[0].operandText, '"literal"');
  assert.equal(Object.hasOwn(raw.instructions[0], 'operandText'), false);
  assert.deepEqual(Object.keys(described.instructions[0]).slice(-3), ['label', 'operandText', 'point']);
  assert.equal(inspector.decodedMethods.size, 0);
  assert.strictEqual(decodedInspectorMethod(inspector, token), described);
  assert.strictEqual(inspector.getMethod(token), described);
  assert.equal(count(), 1);
  assert.deepEqual(described, new AssemblyInspector(fixture()).getMethod(token));
});

test('raw decoding never resolves token display and public formatting failures do not poison its cache', () => {
  const { inspector, count } = countedInspector();
  const describe = inspector.describeToken;
  const failure = new Error('display unavailable');
  inspector.describeToken = () => { throw failure; };
  const raw = decodedInspectorMethod(inspector, token);
  assert.equal(raw.instructions[0].name, 'ldstr');
  assert.throws(() => inspector.getMethod(token), error => error === failure);
  assert.equal(inspector.cache.has(token), false);
  assert.strictEqual(inspector.decodedMethods.get(token), raw);
  inspector.describeToken = describe;
  assert.equal(inspector.getMethod(token).instructions[0].operandText, '"literal"');
  assert.equal(inspector.decodedMethods.size, 0);
  assert.equal(count(), 1);
});

test('no-body methods retain complete public shape and invalid MethodDefs retain their diagnostic', () => {
  const bytes = managedFixture({ entry: null, methods: [{ name: 'MissingBody', noBody: true }] });
  const inspector = new AssemblyInspector(bytes);
  const raw = decodedInspectorMethod(inspector, token);
  assert.deepEqual(inspector.getMethod(token), raw);
  assert.equal(inspector.decodedMethods.size, 0);
  assert.throws(() => decodedInspectorMethod(inspector, token + 1), /MethodDef not found/);
  assert.throws(() => inspector.getMethod(token + 1), /MethodDef not found/);
});

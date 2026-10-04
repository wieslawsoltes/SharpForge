import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleILDocument, formatILDocument, AssemblyInspector, CilError, ilLabel } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { managedFixture } from './managed-fixtures.js';
import { documentLayoutFixture, editedLayoutDocument, rebuiltLayoutFixture } from './fixtures/a03-il-document-layout/input.js';

const methodTokens = [0x06000001, 0x06000002, 0x06000003, 0x06000004];
const run = (bytes, methodToken) => {
  const result = new CilVirtualMachine(bytes, { methodToken }).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return result.returnValue;
};

test('default IL-document body encoding preserves explicit widths, flags and EH fields', () => {
  const original = documentLayoutFixture();
  const document = formatILDocument(original);
  const rebuilt = assembleILDocument(document).bytes;
  assert.deepEqual(rebuilt, assembleILDocument(document, { relaxBranches: false }).bytes);
  const before = new AssemblyInspector(original), after = new AssemblyInspector(rebuilt);
  for (const token of methodTokens) {
    const left = before.pe.methodBody(token), right = after.pe.methodBody(token);
    for (const field of ['code', 'handlers', 'maxStack', 'localSignature', 'initLocals']) assert.deepEqual(right[field], left[field]);
  }
  assert.equal(after.getMethod(methodTokens[0]).initLocals, false);
  assert.equal(after.getMethod(methodTokens[0]).maxStack, 1);
});

test('opt-in layout widens edited short branches and preserves native/direct CIL behavior', () => {
  const text = editedLayoutDocument();
  assert.throws(() => assembleILDocument(text), /Short branch out of range/);
  const bytes = assembleILDocument(text, { relaxBranches: true }).bytes;
  const inspector = new AssemblyInspector(bytes);
  assert.equal(inspector.getMethod(methodTokens[0]).instructions[0].name, 'br');
  for (const [token, expected] of [[methodTokens[0], 42], [methodTokens[1], 42], [methodTokens[3], 44]]) {
    assert.equal(run(bytes, token), expected);
  }
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-il-document-layout/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.runtime, '.NET 10.0.5');
  assert.deepEqual(capture.results, { Main: 42, Catch: 42, Filter: 43, Switch: 44 });
});

test('layout remaps catch/filter starts, ends and handler endpoints with both shrinking and widening', () => {
  const before = new AssemblyInspector(documentLayoutFixture());
  const after = new AssemblyInspector(rebuiltLayoutFixture());
  const oldCatch = before.getMethod(methodTokens[1]), newCatch = after.getMethod(methodTokens[1]);
  assert.equal(newCatch.handlers[0].start, oldCatch.handlers[0].start);
  assert.equal(newCatch.handlers[0].end, oldCatch.handlers[0].end);
  assert.equal(newCatch.handlers[0].handlerEnd, oldCatch.handlers[0].handlerEnd + 3);
  assert.equal(newCatch.instructions.find(instruction => instruction.name === 'leave').operand, newCatch.handlers[0].handlerEnd + 301);
  const oldFilter = before.getMethod(methodTokens[2]), newFilter = after.getMethod(methodTokens[2]);
  assert.equal(newFilter.instructions[0].name, 'br.s');
  assert.equal(newFilter.handlers[0].catchType, oldFilter.handlers[0].catchType - 3);
  assert.equal(newFilter.handlers[0].end, oldFilter.handlers[0].end - 3);
  assert.equal(newFilter.handlers[0].target, oldFilter.handlers[0].target - 3);
  assert.equal(newFilter.handlers[0].handlerEnd, oldFilter.handlers[0].handlerEnd);
  const starts = new Set(newFilter.instructions.map(instruction => instruction.offset));
  for (const field of ['start', 'end', 'target', 'handlerEnd', 'catchType']) assert(starts.has(newFilter.handlers[0][field]));
});

test('switch targets and implicit method-end EH labels survive explicit layout', () => {
  const bytes = managedFixture({ methods: [{ name: 'Main', result: 'int', locals: ['int'],
    body: writer => writer.mark('try').op('ldnull').op('throw').mark('done').op('ldloc.0').op('ret')
      .mark('catch').op('pop').op('ldc.i4', 42).op('stloc.0')
      .op('leave', 'done').mark('end'),
    handlers: (labels, context) => [{ start: labels.get('try'), end: labels.get('done'), target: labels.get('catch'),
      handlerEnd: labels.get('end'), catchType: context.resolve('System.Exception') }],
  }] });
  const rebuilt = new AssemblyInspector(assembleILDocument(formatILDocument(bytes), { relaxBranches: true }).bytes);
  assert.equal(rebuilt.getMethod(methodTokens[0]).handlers[0].handlerEnd, rebuilt.getMethod(methodTokens[0]).codeSize);
  assert.equal(run(rebuilt.pe.bytes, methodTokens[0]), 42);
  const switched = new AssemblyInspector(rebuiltLayoutFixture()).getMethod(methodTokens[3]);
  const targets = switched.instructions.find(instruction => instruction.name === 'switch').operand;
  assert.deepEqual(targets.map(offset => switched.instructions.find(instruction => instruction.offset === offset).operand), [undefined, 44]);
});

test('document layout rejects invalid options and unresolved or end branch labels', () => {
  const bytes = documentLayoutFixture(), text = formatILDocument(bytes);
  for (const relaxBranches of [null, 0, 1, 'yes']) {
    assert.throws(() => assembleILDocument(text, { relaxBranches }), error => error instanceof CilError && /option/.test(error.message));
  }
  assert.throws(() => assembleILDocument(text.replace(/br.s IL_[\da-f]+/, 'br.s IL_ffff'), { relaxBranches: true }), /Unknown IL label/);
  const size = new AssemblyInspector(bytes).getMethod(methodTokens[0]).codeSize;
  assert.throws(() => assembleILDocument(text.replace(/br.s IL_[\da-f]+/, `br.s ${ilLabel(size)}`), { relaxBranches: true }), /end of method/);
  assert.throws(() => assembleILDocument(text.replace('ldc.i4 42', 'constructor'), { relaxBranches: true }), /Unknown opcode/);
});

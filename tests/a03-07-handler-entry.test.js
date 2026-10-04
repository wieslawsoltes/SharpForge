import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyInspector, verifyCilAssembly } from '@sharpforge/cil';
import { verifiedStackBound } from '../packages/cil/src/verified-stack.js';
import { validateHandlerEntryHeights } from '../packages/cil/src/verify/handlers-access.js';
import { entryFixture, nativeCases } from './fixtures/a03-handler-entry/input.js';

test('reachable try entries require an empty stack for catch, finally, fault and branch entry', () => {
  for (const options of [{}, { flags: 2 }, { flags: 4 }, { branch: true }]) {
    const fixture = entryFixture({ ...options, nonempty: true });
    const inspector = new AssemblyInspector(fixture.bytes);
    const result = verifyCilAssembly(inspector);
    assert.equal(result.success, false, JSON.stringify(options));
    const issues = result.issues.filter(issue => issue.code === 'IL_EH_ENTRY');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].offset, fixture.entryOffset);
    assert.equal(verifiedStackBound(inspector, result, inspector.getMethod(0x06000001)), null);
  }
});

test('empty try entries and no-handler methods retain successful stack proofs', () => {
  for (const options of [{}, { flags: 2 }, { flags: 4 }, { branch: true }, { noHandlers: true }]) {
    const { bytes } = entryFixture(options);
    const inspector = new AssemblyInspector(bytes);
    const result = verifyCilAssembly(inspector);
    assert.equal(result.success, true, JSON.stringify(result.issues));
    assert.ok(verifiedStackBound(inspector, result, inspector.getMethod(0x06000001)));
  }
});

test('shared catch families report one entry violation at the try start', () => {
  const result = verifyCilAssembly(entryFixture({ shared: true, nonempty: true }).bytes);
  assert.equal(result.issues.filter(issue => issue.code === 'IL_EH_ENTRY').length, 1);
  assert.equal(verifyCilAssembly(entryFixture({ shared: true }).bytes).success, true);
});

test('unreachable try entries do not invent heights, and finally still begins with an empty stack', () => {
  const dead = verifyCilAssembly(entryFixture({ dead: true, nonempty: true }).bytes);
  assert.equal(dead.success, true, JSON.stringify(dead.issues));
  const underflow = verifyCilAssembly(entryFixture({ flags: 2, handlerPop: true }).bytes);
  assert.equal(underflow.success, false);
  assert.ok(underflow.issues.some(issue => issue.code === 'IL_STACK' && issue.message.includes('underflow')));
});

test('ten retained ILVerify cases agree with reachable try-entry admission', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-handler-entry/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.observations.length, nativeCases.length);
  for (const fixture of nativeCases) {
    const native = capture.observations.find(value => value.name === fixture.name);
    assert.equal(native.oracle.accepted, fixture.accepted, fixture.name);
    const result = verifyCilAssembly(entryFixture(fixture.options).bytes);
    assert.equal(result.success, native.oracle.accepted, JSON.stringify({ fixture: fixture.name, issues: result.issues }));
  }
});

test('invalid shared or wide try families have a bounded distinct-entry diagnostic set', () => {
  const method = { instructions: Array.from({ length: 1000 }, (_, offset) => ({ offset })),
    handlers: Array.from({ length: 2000 }, (_, index) => ({ start: index >>> 1 })) };
  const offsets = new Map(method.instructions.map(({ offset }) => [offset, offset]));
  const heights = new Map(method.instructions.map(({ offset }) => [offset, 1]));
  const issues = [];
  validateHandlerEntryHeights(method, offsets, heights, (...args) => issues.push(args));
  assert.equal(issues.length, 200);
  assert.equal(new Set(issues.map(args => args[1].offset)).size, 200);
});

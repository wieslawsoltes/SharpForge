import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, verifyCilAssembly } from '@sharpforge/cil';
import { verifiedStackBound } from '../packages/cil/src/verified-stack.js';
import { flowFixture, nativeCases } from './fixtures/a03-eh-admission/input.js';
import { entryFixture } from './fixtures/a03-handler-entry/input.js';
import { exceptionFixture } from './support/exception-encoding.js';

test('runtime admission rejects ordinary branches leaving a try before granting a stack proof', () => {
  const { bytes, sourceOffset } = flowFixture({ mode: 'branch-exit' });
  const inspector = new AssemblyInspector(bytes), result = verifyCilAssembly(inspector);
  assert.equal(result.success, false);
  const issue = result.issues.find(value => value.code === 'IL_EH_FLOW');
  assert.equal(issue.diagnostic, 'CILCF0008');
  assert.equal(issue.offset, sourceOffset);
  assert.equal(issue.methodToken, 0x06000001);
  assert.equal(verifiedStackBound(inspector, result, inspector.getMethod(0x06000001)), null);
});

test('runtime admission reuses placement, branch, switch, fallthrough and leave diagnostics', () => {
  for (const fixture of nativeCases.filter(value => !value.accepted)) {
    const { bytes, sourceOffset } = flowFixture(fixture.options);
    const result = verifyCilAssembly(bytes);
    assert.equal(result.success, false, fixture.name);
    const issue = result.issues.find(value => value.code === 'IL_EH_FLOW');
    assert.equal(issue?.diagnostic, fixture.diagnostic, JSON.stringify(result.issues));
    assert.equal(issue.offset, sourceOffset, fixture.name);
  }
});

test('malformed EH geometry and instruction boundaries stop before stack traversal', () => {
  for (const [mode, diagnostic] of [['overlap', 'CILR0023'], ['boundary', 'CILR0016']]) {
    const result = verifyCilAssembly(flowFixture({ mode }).bytes);
    assert.equal(result.success, false);
    assert.equal(result.issues[0].diagnostic, diagnostic);
    assert.deepEqual(result.stackHeights, {});
  }
});

test('valid catch, finally, fault and coincident catch-seeded nested tries retain admission', () => {
  for (const fixture of nativeCases.filter(value => value.accepted)) {
    const inspector = new AssemblyInspector(flowFixture(fixture.options).bytes);
    const result = verifyCilAssembly(inspector);
    assert.equal(result.success, true, JSON.stringify(result.issues));
    assert.ok(verifiedStackBound(inspector, result, inspector.getMethod(0x06000001)));
  }
  for (const options of [{}, { nonempty: true }, { nonempty: true, reentry: true }, { nonempty: true, externalReentry: true }]) {
    const result = verifyCilAssembly(entryFixture({ nestedCatch: true, ...options }).bytes);
    assert.equal(result.success, true, JSON.stringify(result.issues));
  }
});

test('admission reuses the cached instruction array without requesting PE method bytes again', () => {
  const inspector = new AssemblyInspector(flowFixture().bytes);
  const method = inspector.getMethod(0x06000001);
  assert.equal(Object.hasOwn(method, 'code'), false);
  Object.freeze(method.instructions);
  for (const instruction of method.instructions) Object.freeze(instruction);
  inspector.pe.methodBody = () => { throw new Error('PE body must not be reread'); };
  const result = verifyCilAssembly(inspector);
  assert.equal(result.success, true, JSON.stringify(result.issues));
  assert.equal(inspector.getMethod(0x06000001).instructions, method.instructions);
});

test('EH work bounds and cancellation are reported, while zero-handler methods keep their fast path', () => {
  const inspector = new AssemblyInspector(flowFixture().bytes);
  inspector.getMethod(0x06000001);
  for (const options of [{ maxClauses: 0 }, { maxCodeBytes: 0 }, { maxInstructions: 0 }, { signal: AbortSignal.abort() }]) {
    const result = verifyCilAssembly(inspector, options);
    assert.equal(result.success, false);
    assert(['CILR0002', 'CILR0029', 'CILR0003'].includes(result.issues[0].diagnostic));
  }
  const plain = new AssemblyInspector(flowFixture({ noHandlers: true }).bytes);
  assert.equal(verifyCilAssembly(plain, { maxClauses: 0, maxCodeBytes: 0, maxInstructions: 0 }).success, true);
});

test('valid lexical filter geometry does not enable unsupported filter execution', () => {
  const fixture = exceptionFixture();
  const result = verifyCilAssembly(fixture.assembly, { methodToken: fixture.methodToken });
  assert.equal(result.success, false);
  assert(result.issues.some(value => value.code === 'IL_FILTER'));
  assert(!result.issues.some(value => value.code === 'IL_EH_FLOW'));
});

test('retained ILVerify flow cases agree with runtime admission and intended diagnostics', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-eh-admission/native.json', import.meta.url), 'utf8'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(capture.inputSHA256, hash(readFileSync(new URL('./fixtures/a03-eh-admission/input.js', import.meta.url))));
  assert.equal(capture.observations.length, nativeCases.length);
  for (const fixture of nativeCases) {
    const observed = capture.observations.find(value => value.name === fixture.name);
    const { bytes } = flowFixture(fixture.options);
    assert.equal(observed.assemblySHA256, hash(bytes));
    assert.equal(observed.oracle.accepted, fixture.accepted);
    if (!fixture.accepted) assert(observed.oracle.errors.includes(fixture.nativeError));
    assert.equal(verifyCilAssembly(bytes).success, fixture.accepted);
  }
});

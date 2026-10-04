import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, verifyCilAssembly, validateExceptionInstructionPlacement } from '@sharpforge/cil';
import { verifiedStackBound } from '../packages/cil/src/verified-stack.js';
import { placementFixture, nativeCases } from './fixtures/a03-no-handler-placement/input.js';

test('handler-only instructions in methods without clauses fail before acquiring a stack proof', () => {
  for (const fixture of nativeCases.filter(value => !value.accepted)) {
    const { bytes, sourceOffset } = placementFixture(fixture.options);
    const inspector = new AssemblyInspector(bytes);
    const result = verifyCilAssembly(inspector);
    assert.equal(result.success, false, fixture.name);
    const issue = result.issues.find(value => value.code === 'IL_EH_FLOW');
    assert.equal(issue?.diagnostic, fixture.diagnostic, JSON.stringify(result.issues));
    assert.equal(issue.offset, sourceOffset);
    assert.equal(issue.methodToken, 0x06000001);
    assert.deepEqual(result.stackHeights, {});
    assert.equal(verifiedStackBound(inspector, result, inspector.getMethod(0x06000001)), null);
  }
});

test('no-handler admission uses the standalone lexical placement rules, including unreachable instructions', () => {
  for (const fixture of nativeCases.filter(value => !value.accepted)) {
    const { bytes, sourceOffset } = placementFixture({ ...fixture.options, unreachable: true });
    const inspector = new AssemblyInspector(bytes);
    const body = inspector.pe.methodBody(0x06000001);
    assert.throws(() => validateExceptionInstructionPlacement(body.code, []), error =>
      error.code === fixture.diagnostic && error.offset === sourceOffset);
    const result = verifyCilAssembly(inspector);
    assert.equal(result.success, false);
    assert.equal(result.issues[0].diagnostic, fixture.diagnostic);
    assert.equal(result.issues[0].offset, sourceOffset);
    assert.deepEqual(result.stackHeights, {});
  }
});

test('ordinary no-handler return, throw and branch bodies retain admission without EH budgets or rereads', () => {
  for (const fixture of nativeCases.filter(value => value.accepted)) {
    const inspector = new AssemblyInspector(placementFixture(fixture.options).bytes);
    const method = inspector.getMethod(0x06000001);
    Object.freeze(method.instructions);
    for (const instruction of method.instructions) Object.freeze(instruction);
    inspector.pe.methodBody = () => { throw new Error('No PE method-body reread'); };
    const result = verifyCilAssembly(inspector, { maxClauses: 0, maxCodeBytes: 0, maxInstructions: 0 });
    assert.equal(result.success, true, JSON.stringify(result.issues));
    assert.ok(verifiedStackBound(inspector, result, method));
    assert.equal(inspector.getMethod(0x06000001).instructions, method.instructions);
  }
});

test('pinned ILVerify no-handler placement observations match source and image bytes', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-no-handler-placement/native.json', import.meta.url), 'utf8'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(capture.inputSHA256, hash(readFileSync(new URL('./fixtures/a03-no-handler-placement/input.js', import.meta.url))));
  assert.equal(capture.observations.length, nativeCases.length);
  for (const fixture of nativeCases) {
    const observed = capture.observations.find(value => value.name === fixture.name);
    const { bytes } = placementFixture(fixture.options);
    assert.equal(observed.assemblySHA256, hash(bytes));
    if (fixture.name === 'endfinally') {
      assert.equal(capture.runtime, '10.0.5');
      assert.match(capture.toolSHA256, /^[a-f0-9]{64}$/);
      assert.equal(observed.oracle.status, 'unavailable');
      assert.equal(observed.oracle.accepted, null);
      assert.equal(observed.verify.exitCode, 1);
      assert.equal(observed.verify.signal, null);
      assert.match(observed.verify.stderr, /System.InvalidOperationException: Nullable object must have a value\./);
      assert.match(observed.verify.stderr, /at Internal\.IL\.ILImporter\.ImportEndFinally\(\)/);
    } else {
      assert.equal(observed.oracle.accepted, fixture.accepted);
      if (!fixture.accepted) assert(observed.oracle.errors.includes(fixture.nativeError));
    }
    assert.equal(verifyCilAssembly(bytes).success, fixture.accepted);
  }
});

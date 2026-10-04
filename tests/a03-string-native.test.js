import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { literalFixture } from './fixtures/verifier-literals/input.js';
import { literalCases } from './fixtures/verifier-literals/cases.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('pinned ILVerify String observations retain exact bytes, tool versions and policy boundaries', () => {
  const root = new URL('./fixtures/verifier-literals/', import.meta.url);
  const capture = JSON.parse(readFileSync(new URL('native.json', root), 'utf8'));
  assert.equal(capture.oracle, 'ILVerify');
  assert.equal(capture.version, '10.0.5');
  assert.equal(capture.sdk, '10.0.201');
  assert.equal(capture.runtime, '10.0.5');
  assert.equal(capture.inputSHA256, hash(readFileSync(new URL('input.js', root))));
  for (const [name, expected] of Object.entries(capture.inputs))
    assert.equal(hash(readFileSync(new URL(name, root))), expected, name);
  assert.equal(capture.observations.length, literalCases.length);
  for (const fixture of literalCases) {
    const observed = capture.observations.find(value => value.name === fixture.name);
    assert.ok(observed, fixture.name);
    assert.equal(observed.assemblySHA256, hash(literalFixture(fixture).bytes), fixture.name);
    assert.equal(observed.policyStatus, fixture.status, fixture.name);
    assert.equal(observed.oracle.accepted, fixture.nativeAccepted ?? fixture.status === 'verified', fixture.name);
    assert.equal(observed.difference, fixture.difference ?? null, fixture.name);
    assert.ok(observed.verify.stdout.includes('Methods verified: 1'), fixture.name);
    assert.equal(observed.verify.signal, null, fixture.name);
    assert.equal(observed.verify.exitCode, observed.oracle.accepted ? 0 : 2, fixture.name);
    if (fixture.status !== 'unknown' && observed.oracle.accepted !== (fixture.status === 'verified'))
      assert.ok(fixture.difference, fixture.name);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fieldFixture } from './fixtures/verifier-fields/input.js';
import { fieldCases } from './fixtures/verifier-fields/cases.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('pinned ILVerify field observations retain exact input hashes and predeclared policy boundaries', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/verifier-fields/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.version, '10.0.5');
  for (const [name, expected] of Object.entries(capture.inputs))
    assert.equal(hash(readFileSync(new URL('./fixtures/verifier-fields/' + name, import.meta.url))), expected, name);
  assert.equal(capture.observations.length, fieldCases.length);
  for (const fixture of fieldCases) {
    const native = capture.observations.find(value => value.name === fixture.name);
    assert.equal(native.assemblySHA256, hash(fieldFixture(fixture).bytes), fixture.name);
    assert.equal(native.policyStatus, fixture.status);
    assert.equal(native.oracle.accepted, fixture.nativeAccepted ?? fixture.status === 'verified', fixture.name);
    assert.equal(native.difference, fixture.difference ?? null);
    if (fixture.status !== 'unknown' && native.oracle.accepted !== (fixture.status === 'verified'))
      assert.ok(fixture.difference, fixture.name);
  }
});

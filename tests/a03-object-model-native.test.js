import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector } from '@sharpforge/cil';
import { parseILVerify } from '../scripts/conformance/verifier/catalog.js';
import { verifierPin } from '../scripts/conformance/verifier/tools.js';
import { pin } from '../scripts/conformance/oracle/toolchain.js';
import { objectFixture } from './fixtures/verifier-object-model/input.js';
import { objectCases } from './fixtures/verifier-object-model/cases.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('pinned object observations retain exact CLI bytes, tool identity and one selected caller', () => {
  const root = new URL('./fixtures/verifier-object-model/', import.meta.url);
  const capture = JSON.parse(readFileSync(new URL('native.json', root), 'utf8'));
  assert.equal(capture.oracle, 'ILVerify');
  assert.equal(capture.version, '10.0.5');
  assert.equal(capture.sdk, '10.0.201');
  assert.equal(capture.runtime, '10.0.5');
  assert.equal(capture.toolSHA256, verifierPin.files.find(value => value.path === verifierPin.entry).sha256);
  assert.equal(capture.references.count, pin.referenceAssemblies.count);
  assert.equal(capture.references.sha256, pin.referenceAssemblies.sha256);
  assert.equal(capture.methodFilter, '\\.Test$');
  assert.equal(capture.inputSHA256, hash(readFileSync(new URL('input.js', root))));
  for (const [name, expected] of Object.entries(capture.inputs))
    assert.equal(hash(readFileSync(new URL(name, root))), expected, name);
  assert.equal(capture.observations.length, objectCases.length);
  assert.equal(new Set(capture.observations.map(value => value.name)).size, objectCases.length);
  for (const fixture of objectCases) {
    const observed = capture.observations.find(value => value.name === fixture.name);
    assert.ok(observed, fixture.name);
    const input = objectFixture(fixture);
    assert.ok(new AssemblyInspector(input.bytes).methods.size > 1, fixture.name);
    assert.equal(observed.assemblySHA256, hash(input.bytes), fixture.name);
    assert.equal(observed.policyStatus, fixture.status, fixture.name);
    assert.equal(observed.policyDiagnostic, fixture.diagnostic ?? null, fixture.name);
    assert.equal(observed.difference, fixture.difference ?? null, fixture.name);
    assert.deepEqual(parseILVerify(observed.verify), observed.oracle, fixture.name);
    assert.equal(observed.oracle.accepted, fixture.nativeAccepted ?? fixture.status === 'verified', fixture.name);
  }
});

test('an unmatched or ambiguous method filter and process errors cannot become native rejection observations', () => {
  for (const count of [0, 2]) assert.throws(() => parseILVerify({ exitCode: 0, signal: null,
    stdout: `Methods verified: ${count}\n`, stderr: '' }), /exactly one/);
  assert.throws(() => parseILVerify({ exitCode: 1, signal: null, stdout: 'Methods verified: 1\n', stderr: '' }), /invocation/);
  assert.throws(() => parseILVerify({ exitCode: 2, signal: null, stdout: 'Methods verified: 1\n', stderr: '' }), /mismatch/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const fixture = new URL('./fixtures/pe-inspection/', import.meta.url);
const repository = new URL('../', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = readFileSync(new URL('reference-images.json', fixture));
const manifest = JSON.parse(manifestBytes);
const capture = JSON.parse(readFileSync(new URL('native.json', fixture)));
const comparisonFields = ['imageKind', 'headers', 'sections', 'directories', 'cli', 'debugDirectory', 'strongName', 'methods'];

test('independent PEReader/SRM capture pins exact sources and cache-only reference bytes', () => {
  assert.equal(capture.format, 'sharpforge.pe-inspection.native-capture');
  assert.equal(capture.schemaVersion, 1);
  assert.equal(capture.status, 'pass');
  assert.equal(capture.referencePayloads, 'external-cache-only');
  assert.equal(capture.manifestSha256, digest(manifestBytes));
  assert.equal(capture.toolchain.sdk, '10.0.201');
  assert.equal(capture.toolchain.runtime, '10.0.5');
  assert.equal(capture.compilation.exitCode, 0);
  for (const [file, expected] of Object.entries(capture.sourceSha256))
    assert.equal(digest(readFileSync(new URL(file, repository))), expected, `${file} changed: native capture is stale`);
  assert.deepEqual(capture.observations.map(value => value.id), ['r2r', 'mixed']);
  for (const observation of capture.observations) {
    const image = manifest.images.find(value => value.id === observation.id);
    assert.equal(image.cacheOnly, true);
    assert.equal(observation.imageSha256, image.sha256);
    assert.equal(observation.imageBytes, image.bytes);
    assert.equal(observation.native.image.sha256, image.sha256);
    assert.equal(observation.native.image.bytes, image.bytes);
    assert.equal(observation.native.imageKind, image.expectedImageKind);
    assert.equal(observation.execution.exitCode, 0);
    assert.equal(observation.execution.signal, null);
    assert.equal(observation.inputExecution.status, 'not-run');
    assert.deepEqual(observation.comparison.comparisons, comparisonFields.map(field => ({ field, status: 'pass' })));
    assert.deepEqual(observation.comparison.differences, []);
    assert.ok(observation.comparison.counts.availableCil > 0);
    assert.equal(observation.comparison.counts.methods, observation.native.methods.length);
  }
});

test('recorded real R2R and mixed-mode image facts cover actual non-ILOnly and native method cases', () => {
  const r2r = capture.observations.find(value => value.id === 'r2r');
  assert.equal(r2r.native.cli.flags & 1, 0);
  assert.equal(r2r.native.managedNativeSignature, 0x00525452);
  assert.equal(r2r.native.headers.coff.machine, 0xfd1d);
  assert.ok(r2r.native.methods.some(method => method.hasCilBody && method.body));
  const mixed = capture.observations.find(value => value.id === 'mixed');
  assert.equal(mixed.native.cli.flags, 0);
  assert.equal(mixed.native.managedNativeSignature, null);
  assert.ok(mixed.comparison.counts.nonCil > 0);
  assert.ok(mixed.native.methods.some(method => method.codeKind === 'Native' && method.rva));
  assert.ok(mixed.native.methods.filter(method => method.codeKind !== 'CIL').every(method => method.body === null));
  assert.match(mixed.inputExecution.reason, /Linux execution is unsupported/);
});

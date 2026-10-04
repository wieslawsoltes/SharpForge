import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function pinnedRecording(report) {
  assert.ok(report.toolchain?.roslyn?.version && report.toolchain.runtime, 'Pinned capture requires toolchain provenance');
  assert.equal(report.compilation?.result?.exitCode, 0);
  assert.equal(report.compilation.result.signal, null);
  assert.equal(report.execution?.exitCode, 0);
  assert.equal(report.execution.signal, null);
  assert.equal(report.candidate?.state, 'terminated');
  assert.equal(report.candidate.output, report.execution.stdout.replaceAll('\r\n', '\n'));
  assert.ok(report.fieldRVA > 0 && report.initializers > 0);
  const bytes = new Uint8Array(Buffer.from(report.image.bytes, 'base64'));
  assert.equal(digest(bytes), report.image.sha256);
  return {bytes, sourceSHA256: report.sourceSHA256, output: report.execution.stdout,
    fieldRVA: report.fieldRVA, initializers: report.initializers, kind: 'pinned capture'};
}

async function ciRecording(directory) {
  const captureDirectory = new URL('ci-e093-sdk10/', directory);
  const provenance = await readJson(new URL('provenance.json', captureDirectory));
  assert.equal(provenance.format, 'SharpForge.A05MemoryCiCapture/1');
  const files = {};
  for (const name of ['qualification.json', 'Qualification.dll', 'Qualification.runtimeconfig.json']) {
    const bytes = await readFile(new URL(name, captureDirectory));
    assert.equal(bytes.length, provenance.files[name].bytes, name + ' length');
    assert.equal(digest(bytes), provenance.files[name].sha256, name + ' hash');
    files[name] = bytes;
  }
  const report = JSON.parse(files['qualification.json'].toString('utf8'));
  assert.equal(report.revision, provenance.revision);
  assert.equal(report.fixture, 'a05-memory');
  assert.equal(report.dotnetSdk, '10.0.201');
  assert.equal(report.targetFramework, 'net10.0');
  assert.equal(report.passed, true);
  assert.equal(report.native.exitCode, 0);
  assert.equal(report.native.signal, null);
  assert.equal(report.cil.state, 'terminated');
  assert.equal(report.cil.exitCode, 0);
  assert.equal(report.cil.output, report.native.output.replaceAll('\r\n', '\n'));
  assert.equal(report.native.output, report.expectedOutput);
  assert.equal(report.sources.length, 1);
  assert.equal(report.sources[0].sha256, provenance.sourceSha256);
  const bytes = new Uint8Array(files['Qualification.dll']);
  assert.equal(digest(bytes), report.assemblySha256);
  return {bytes, sourceSHA256: provenance.sourceSha256, output: report.native.output,
    ...provenance.metadataInspection, kind: 'recorded e093 SDK 10 CI capture'};
}

// A generated capture takes precedence. Only its absence permits the retained CI
// recording; a failed, truncated or corrupt capture must remain a replay failure.
export async function readMemoryRecording(directory) {
  let report;
  try {
    report = await readJson(new URL('native.json', directory));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return ciRecording(directory);
  }
  return pinnedRecording(report);
}

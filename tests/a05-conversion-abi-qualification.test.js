import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {conversionMatrixCases} from './support/numeric-conversion-matrix.js';
import {conversionDigest, verifyConversionCapture, verifyConversionQualification} from '../scripts/numeric/conversion-proof.js';
import {replayConversionCapture} from '../scripts/numeric/conversion-replay.js';
import {captureConversions, parseConversionOptions} from '../scripts/numeric/conversion-capture.js';
import {qualifyConversions, finalizeConversions} from '../scripts/numeric/qualify-conversions.js';

function retainedCapture() {
  const directory = new URL('./fixtures/a05/numeric-oracle/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', directory)));
  const read = name => {
    const bytes = readFileSync(new URL(name, directory));
    assert.equal(conversionDigest(bytes), provenance.files[name].sha256);
    return bytes;
  };
  return {sdk: provenance.sdk, cases: JSON.parse(read('conversions.json')),
    output: gunzipSync(read('conversions.txt.gz')).toString('utf8'), native: {exitCode: 0, signal: null},
    nativeRuntime: {nativeIntBits: 64, processArchitecture: 'Arm64', environmentVersion: '10.0.5', exitCode: 0, signal: null}};
}

test('conversion-only capture accepts the retained exact native64 corpus without rewriting it', () => {
  const capture = retainedCapture();
  const result = verifyConversionCapture(capture, {bits: 64, sdk: '10.0.201'});
  assert.equal(result.cases, 2112);
  assert.equal(result.opcodeEncodings, 33);
  assert.equal(result.sourceKinds, 5);
  assert.equal(conversionMatrixCases(32).length, 2277);
});

test('conversion proof rejects invented width, missing operands, reordered rows, abnormal CLR exits and extra output', () => {
  for (const change of [
    capture => { capture.nativeRuntime.nativeIntBits = 32; },
    capture => { capture.nativeRuntime.processArchitecture = 'X86'; },
    capture => { capture.nativeRuntime.environmentVersion = '8.0.31'; },
    capture => { capture.sdk = '10.0.999'; },
    capture => { capture.cases.pop(); },
    capture => { [capture.cases[0], capture.cases[1]] = [capture.cases[1], capture.cases[0]]; },
    capture => { capture.native.exitCode = 1; },
    capture => { capture.nativeRuntime.signal = 'SIGABRT'; },
    capture => { capture.output += '0\n'; },
    capture => { capture.output = capture.output.replace('0\n', '!InvalidProgramException\n'); }
  ]) {
    const capture = retainedCapture();
    change(capture);
    assert.throws(() => verifyConversionCapture(capture, {bits: 64, sdk: '10.0.201'}));
  }
});

test('ABI32 replay compares native-style answers in all three engines including checked conversion failure', () => {
  const cases = conversionMatrixCases(32).filter(row => row.source === 'native' && row.input === '2147483647' &&
    ['conv.i', 'conv.r8', 'conv.ovf.i1'].includes(row.opcode));
  assert.deepEqual(cases.map(row => row.opcode), ['conv.ovf.i1', 'conv.i', 'conv.r8']);
  const expected = '!OverflowException\n2147483647\n4746794007244308480\n';
  const artifacts = [];
  const result = replayConversionCapture(cases, expected, (row, files) => artifacts.push({row: {...row}, files}));
  assert.deepEqual(result.routes.map(row => row.engine), ['source', 'reloaded source', 'direct CIL']);
  for (const route of result.routes) {
    assert.equal(route.cases, 3);
    assert(route.instructions > 0);
    assert.equal(route.outputSha256, conversionDigest(expected));
  }
  assert.deepEqual(artifacts.map(item => item.row.status), ['running', 'running', 'passed']);
  assert(artifacts[1].files.assembly.byteLength > 0);
  const failed = [];
  assert.throws(() => replayConversionCapture(cases, expected.replace('2147483647\n', '2147483646\n'),
    (row, files) => failed.push({row, files})), /native conversion ABI32/);
  assert.equal(failed.at(-1).row.status, 'failed');
  assert.equal(failed.at(-1).files.source, artifacts[0].files.source);
});

test('a summary cannot qualify an omitted engine or a changed source tree', () => {
  const capture = retainedCapture();
  const inventory = verifyConversionCapture(capture, {bits: 64, sdk: capture.sdk});
  const identity = {revision: '1'.repeat(40), tree: '2'.repeat(40)};
  const make = () => ({format: 'SharpForge.NativeConversionQualification/1', status: 'passed',
    expected: {bits: 64, sdk: capture.sdk}, capture, inventory, sourceBefore: identity, sourceAfter: identity,
    replay: {routes: ['source', 'reloaded source', 'direct CIL'].map(engine =>
      ({engine, cases: inventory.cases, outputSha256: inventory.outputSha256, instructions: 1}))}});
  verifyConversionQualification(make(), {bits: 64, sdk: capture.sdk});
  const omitted = make();
  omitted.replay.routes.pop();
  assert.throws(() => verifyConversionQualification(omitted, {bits: 64, sdk: capture.sdk}));
  const changed = make();
  changed.sourceAfter = {...identity, revision: '3'.repeat(40)};
  assert.throws(() => verifyConversionQualification(changed, {bits: 64, sdk: capture.sdk}));
});

test('capture refuses evidence overwrite and finalization preserves a missing-run failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-conversion-only-'));
  try {
    const options = parseConversionOptions(['--output', directory, '--sdk', '10.0.201', '--native-bits', '32']);
    writeFileSync(join(directory, 'original.txt'), 'retain this evidence\n');
    await assert.rejects(qualifyConversions(options), /already exists/);
    assert.equal(readFileSync(join(directory, 'original.txt'), 'utf8'), 'retain this evidence\n');
    assert.equal(finalizeConversions(options).status, 'failed');
    assert.match(JSON.parse(readFileSync(join(directory, 'final-outcome.json'))).error.message, /qualification.json/);
    assert.throws(() => parseConversionOptions(['--output', directory, '--sdk', '8.0.425']), /10/);
    assert.throws(() => parseConversionOptions(['--output', directory, '--native-bits', '16']));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('a non-CLR executable cannot qualify and its actual command output remains available', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-conversion-process-'));
  try {
    const journal = {commands: []};
    await assert.rejects(captureConversions({output: directory, dotnet: process.execPath, sdk: '10.0.201', bits: 32}, journal),
      /exact requested SDK/);
    const retained = JSON.parse(readFileSync(join(directory, 'journal.json')));
    assert.equal(retained.commands[0].exitCode, 0);
    assert.equal(retained.commands[0].signal, null);
    assert.equal(readFileSync(join(directory, 'command-0.stdout.txt'), 'utf8').trim(), process.version);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

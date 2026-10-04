import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {conversionMatrixCases} from '../../tests/support/numeric-conversion-matrix.js';

export const conversionDigest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Require the real CLR identity and the unchanged complete opcode/source/operand inventory. */
export function verifyConversionCapture(capture, expected) {
  assert.equal(capture.sdk, expected.sdk, 'Conversion capture must use the requested SDK');
  assert.match(capture.sdk, /^10\./, 'The saturation oracle is pinned to .NET 10');
  const runtime = capture.nativeRuntime;
  assert.equal(runtime.nativeIntBits, expected.bits, 'Actual CLR pointer width must match the requested ABI');
  assert(expected.bits === 32 ? runtime.processArchitecture === 'X86' : ['X64', 'Arm64'].includes(runtime.processArchitecture),
    'Actual CLR architecture must match the requested ABI');
  assert.match(runtime.environmentVersion, /^10\./, 'The executing CLR must be .NET 10');
  assert.equal(runtime.exitCode, 0);
  assert.equal(runtime.signal, null);
  assert.equal(capture.native.exitCode, 0, 'Every native conversion must execute successfully');
  assert.equal(capture.native.signal, null);
  assert.deepEqual(capture.cases, conversionMatrixCases(expected.bits), 'Complete unchanged conversion matrix');
  const lines = capture.output.split('\n');
  assert.equal(lines.pop(), '', 'Native conversion output must end with a newline');
  assert.equal(lines.length, capture.cases.length, 'One native answer is required for every conversion case');
  for (const line of lines) assert.match(line, /^(?:-?\d+|NaN|!OverflowException)$/, 'Unexpected native conversion outcome');
  return {cases: capture.cases.length, sourceKinds: 5, opcodeEncodings: 33, targetEncodings: 13,
    nativeIntBits: expected.bits, concreteTargetsAcrossBothAbis: 15,
    outputSha256: conversionDigest(capture.output), casesSha256: conversionDigest(JSON.stringify(capture.cases, null, 2) + '\n')};
}

/** A later workflow finalizer cannot promote a partial capture or missing engine to a pass. */
export function verifyConversionQualification(report, expected) {
  assert.equal(report.format, 'SharpForge.NativeConversionQualification/1');
  assert.equal(report.status, 'passed', 'Conversion qualification did not complete');
  assert.equal(report.expected.sdk, expected.sdk);
  assert.equal(report.expected.bits, expected.bits);
  assert.equal(report.capture.sdk, expected.sdk);
  assert.equal(report.capture.nativeRuntime.nativeIntBits, expected.bits);
  assert(expected.bits === 32 ? report.capture.nativeRuntime.processArchitecture === 'X86' :
    ['X64', 'Arm64'].includes(report.capture.nativeRuntime.processArchitecture));
  assert.equal(report.inventory.cases, conversionMatrixCases(expected.bits).length);
  assert.deepEqual(report.replay.routes.map(row => row.engine), ['source', 'reloaded source', 'direct CIL']);
  for (const route of report.replay.routes) {
    assert.equal(route.cases, report.inventory.cases, route.engine + ': all operands must be compared');
    assert.equal(route.outputSha256, report.inventory.outputSha256, route.engine + ': exact native output');
    assert(route.instructions > 0, route.engine + ': guest execution is required');
  }
  assert.match(report.sourceBefore?.revision ?? '', /^[a-f0-9]{40}$/);
  assert.match(report.sourceBefore?.tree ?? '', /^[a-f0-9]{40}$/);
  assert.deepEqual(report.sourceAfter, report.sourceBefore, 'Source identity changed during qualification');
  return report.inventory;
}

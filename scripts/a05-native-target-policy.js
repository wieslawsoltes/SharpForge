import assert from 'node:assert/strict';
import {verifyNativeOutcome} from './a05-native-outcome.js';

const varargsMessage = /(?:^|\n)Unhandled exception\. System\.InvalidProgramException: Vararg calling convention not supported\.(?:\r?\n|$)/;
export const managedVarargsUnsupported = 'CLR_MANAGED_VARARGS_UNSUPPORTED';

/** Classify only an observed native execution failure, never an OS, compiler diagnostic or VM fault. */
export function verifyNativeTargetOutcome(report, allowManagedVarargs = false) {
  const {native, cil, expectedOutput} = report;
  const abnormal = native.signal === 'SIGABRT' || native.signal == null && Number.isInteger(native.exitCode) && native.exitCode !== 0;
  if (!allowManagedVarargs || !abnormal || !varargsMessage.test(native.stderr ?? '')) {
    verifyNativeOutcome(report);
    return 'passed';
  }
  assert(cil, 'Unsupported CLR varargs still requires independent VM execution');
  assert.equal(cil.state, 'terminated', cil.fault?.message);
  assert.equal(cil.exitCode, 0, 'CIL authored varargs trace must terminate successfully');
  assert.equal(cil.output, expectedOutput, 'CIL/authored varargs stdout');
  report.nativeUnsupported = {
    code: managedVarargsUnsupported,
    stage: 'native-execution',
    reason: 'The executed CLR rejected the managed varargs calling convention.',
    nativeParity: false,
    cilAuthoredTracePassed: true
  };
  return 'unsupported';
}

export function nativeFixtureStatus(reports) {
  const status = reports.some(report => report.status !== 'passed' && report.status !== 'unsupported') ? 'failed' :
    reports.some(report => report.status === 'unsupported') ? 'partial' : 'passed';
  return {status, passed: status === 'passed'};
}

/** The parent process may propagate a partial result only after the child checked the exact observed failure and VM trace. */
export function nativeTargetCaseOutcome(summary) {
  assert(Array.isArray(summary.fixtures) && summary.fixtures.length > 0, 'Missing native fixture outcomes');
  if (summary.status === 'passed' && summary.passed === true && summary.fixtures.every(item => item.status === 'passed')) return 'passed';
  assert.equal(summary.status, 'partial', 'Native fixture outcome is not a completed partial report');
  assert.equal(summary.passed, false, 'An unsupported target cannot claim a native pass');
  assert(summary.fixtures.some(item => item.status === 'unsupported'), 'Missing unsupported native target');
  for (const item of summary.fixtures) {
    if (item.status === 'passed') continue;
    assert.equal(item.status, 'unsupported', 'A failed fixture cannot be relabeled unsupported');
    assert.equal(item.nativeUnsupported?.code, managedVarargsUnsupported);
    assert.equal(item.nativeUnsupported?.stage, 'native-execution');
    assert.equal(item.nativeUnsupported?.nativeParity, false);
    assert.equal(item.nativeUnsupported?.cilAuthoredTracePassed, true);
  }
  return 'unsupported';
}

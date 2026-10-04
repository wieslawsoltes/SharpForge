import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNativeOutcome} from '../scripts/a05-native-outcome.js';
import {nativeFixtureProject} from '../scripts/a05-native-project.js';
import {verifyNativeTargetOutcome, nativeFixtureStatus, nativeTargetCaseOutcome} from '../scripts/a05-native-target-policy.js';

const output = 'first\nsecond\nterminal\n';
const failure = () => ({
  expectedOutput: output,
  expectedFault: 'Exception',
  native: {exitCode: null, signal: 'SIGABRT', output, stderr: 'Unhandled exception. System.Exception: terminal\n'},
  cil: {state: 'faulted', exitCode: -532462766, output, fault: {name: 'Exception', message: 'terminal'}}
});

test('native fault qualification retains platform-specific exits while requiring identical ordered traces', () => {
  for (const [exitCode, signal] of [[null, 'SIGABRT'], [134, null], [-532462766, null]]) {
    const report = failure();
    Object.assign(report.native, {exitCode, signal});
    assert.doesNotThrow(() => verifyNativeOutcome(report));
  }
});

test('native fault qualification accepts canonical System names without erasing foreign namespaces', () => {
  for (const name of ['Exception', 'System.Exception']) {
    const report = failure();
    report.cil.fault.name = name;
    assert.doesNotThrow(() => verifyNativeOutcome(report));
  }
  for (const name of ['Acme.Exception', 'System.Acme.Exception', 'System.InvalidOperationException',
    'RuntimeException', 'AssertionException', undefined]) {
    const report = failure();
    report.cil.fault.name = name;
    assert.throws(() => verifyNativeOutcome(report), assert.AssertionError);
  }
});

test('successful exits, unrelated signals, wrong exceptions and changed event order cannot qualify', () => {
  for (const mutate of [
    report => Object.assign(report.native, {exitCode: 0, signal: null}),
    report => Object.assign(report.native, {exitCode: null, signal: 'SIGTERM'}),
    report => { report.native.stderr = 'Unhandled exception. System.InvalidOperationException: other\n'; },
    report => { report.native.output = 'second\nfirst\nterminal\n'; },
    report => { report.cil.output = 'first\nterminal\n'; },
    report => { report.cil.state = 'terminated'; },
    report => { report.cil.exitCode = 0; },
    report => { report.cil.fault.name = 'InvalidOperationException'; }
  ]) {
    const report = failure();
    mutate(report);
    assert.throws(() => verifyNativeOutcome(report), assert.AssertionError);
  }
});

test('ordinary success fixtures keep exact zero-exit semantics', () => {
  const report = {expectedOutput: 'done\n', native: {exitCode: 0, signal: null, output: 'done\n'},
    cil: {state: 'terminated', exitCode: 0, output: 'done\n'}};
  assert.doesNotThrow(() => verifyNativeOutcome(report));
  report.native.signal = 'SIGABRT';
  assert.throws(() => verifyNativeOutcome(report), assert.AssertionError);
});

test('first-chance failfast requires the pinned native HRESULT and the VM fatal boundary', () => {
  const report = failure();
  report.failfast = true;
  report.expectedFault = 'ExecutionEngineException';
  report.native.stderr = 'Fatal error. Internal CLR error. (0x80131506)\n';
  report.cil.exitCode = 0x80131506 | 0;
  report.cil.fault = {name: 'ExecutionEngineException', fatal: true};
  assert.doesNotThrow(() => verifyNativeOutcome(report));
  report.cil.fault.fatal = false;
  assert.throws(() => verifyNativeOutcome(report), assert.AssertionError);
  report.cil.fault.fatal = true;
  report.cil.fault.name = 'ExecutionLimitException';
  assert.throws(() => verifyNativeOutcome(report), assert.AssertionError);
  report.cil.fault.name = 'ExecutionEngineException';
  report.native.stderr = 'Fatal error. Unrelated process failure. (0x80004005)\n';
  assert.throws(() => verifyNativeOutcome(report), assert.AssertionError);
});

test('native fixture projects opt into unsafe compilation only for explicitly selected fixtures', () => {
  assert.match(nativeFixtureProject('net8.0'), /<AllowUnsafeBlocks>false<\/AllowUnsafeBlocks>/);
  assert.match(nativeFixtureProject('net10.0', true), /<AllowUnsafeBlocks>true<\/AllowUnsafeBlocks>/);
  assert.match(nativeFixtureProject('net8.0'), /<TargetFramework>net8\.0<\/TargetFramework>/);
});

const unsupportedVarargs = () => ({expectedOutput: '42\n',
  native: {exitCode: null, signal: 'SIGABRT', output: '',
    stderr: 'Unhandled exception. System.InvalidProgramException: Vararg calling convention not supported.\n   at Program.Main()\n'},
  cil: {state: 'terminated', exitCode: 0, output: '42\n'}});

test('observed CLR varargs rejection remains unsupported after an independent authored VM trace succeeds', () => {
  const report = unsupportedVarargs();
  const native = structuredClone(report.native);
  report.status = verifyNativeTargetOutcome(report, true);
  assert.equal(report.status, 'unsupported');
  assert.deepEqual(report.native, native, 'preserve the complete native failure observation');
  assert.equal(report.nativeUnsupported.nativeParity, false);
  assert.equal(report.nativeUnsupported.cilAuthoredTracePassed, true);
  const summary = {...nativeFixtureStatus([report]), fixtures: [report]};
  assert.deepEqual({status: summary.status, passed: summary.passed}, {status: 'partial', passed: false});
  assert.equal(nativeTargetCaseOutcome(summary), 'unsupported');
  report.nativeUnsupported.cilAuthoredTracePassed = false;
  assert.throws(() => nativeTargetCaseOutcome(summary), assert.AssertionError);
});

test('varargs policy cannot hide wrong native exceptions, successful native divergence, signals or VM failures', () => {
  assert.throws(() => verifyNativeTargetOutcome(unsupportedVarargs()), assert.AssertionError);
  for (const mutate of [
    report => { report.native.stderr = 'Unhandled exception. System.InvalidProgramException: Different failure.\n'; },
    report => { report.native.stderr = 'Unhandled exception. Acme.InvalidProgramException: Vararg calling convention not supported.\n'; },
    report => { report.native.stderr = 'error CS0000: Vararg calling convention not supported.\n'; },
    report => { report.native.signal = 'SIGTERM'; },
    report => { report.native.signal = null; report.native.exitCode = 0; },
    report => { report.cil.state = 'faulted'; },
    report => { report.cil.exitCode = 1; },
    report => { report.cil.output = 'wrong\n'; }
  ]) {
    const report = unsupportedVarargs(); mutate(report);
    assert.throws(() => verifyNativeTargetOutcome(report, true), assert.AssertionError);
  }
  const report = unsupportedVarargs();
  report.native = {exitCode: 0, signal: null, output: '42\n', stderr: ''};
  assert.equal(verifyNativeTargetOutcome(report, true), 'passed', 'supported hosts must retain the native comparison');
  assert.equal(report.nativeUnsupported, undefined);
});

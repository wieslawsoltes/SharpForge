import assert from 'node:assert/strict';

/** Compare exact traces while retaining the platform-specific native fatal exit or signal. */
export function verifyNativeOutcome({native, cil, expectedOutput, expectedFault, failfast = false}) {
  assert(!failfast || expectedFault === 'ExecutionEngineException', 'Failfast requires the pinned CoreCLR fatal type');
  assert.equal(native.output, expectedOutput, 'Native/expected stdout');
  if (cil) assert.equal(cil.output, native.output, 'CIL/native stdout');
  if (!expectedFault) {
    assert.equal(native.signal ?? null, null, 'Native success cannot terminate by signal');
    assert.equal(native.exitCode, 0, 'Native exit code');
    if (cil) {
      assert.equal(cil.state, 'terminated', cil.fault?.message);
      assert.equal(cil.exitCode, native.exitCode, 'CIL/native exit code');
    }
    return;
  }
  assert(/^[A-Za-z][A-Za-z0-9]*Exception$|^Exception$/.test(expectedFault), 'Expected System exception type');
  assert(native.signal === 'SIGABRT' || native.signal == null && Number.isInteger(native.exitCode) && native.exitCode !== 0,
    'Native unhandled exception must produce a nonzero exit or SIGABRT');
  if (failfast) assert(/0x80131506\b/i.test(native.stderr), 'Native stderr must identify the CoreCLR execution-engine failfast code');
  else assert(native.stderr.includes(`System.${expectedFault}:`), 'Native stderr must identify the expected unhandled exception');
  assert(cil, 'Unhandled qualification requires the VM result');
  assert.equal(cil.state, 'faulted', 'CIL unhandled exception state');
  assert(Number.isInteger(cil.exitCode) && cil.exitCode !== 0, 'CIL unhandled exception exit code');
  // Runtime catch matching also aliases RuntimeException/limit faults. Native
  // qualification requires the exact type, allowing only its System short name.
  const actual = cil.fault?.name;
  assert.equal(actual === expectedFault ? `System.${actual}` : actual, `System.${expectedFault}`, 'CIL unhandled exception identity');
  if (failfast) {
    assert.equal(cil.fault.fatal, true, 'CIL first-chance callback failure is fatal');
    assert.equal(cil.exitCode, 0x80131506 | 0, 'CIL execution-engine process code');
  }
}
